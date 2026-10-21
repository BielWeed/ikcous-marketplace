-- ============================================================================
-- Migration 20261352000000 — o produto e a grade salvam numa transação só
-- ADITIVA: só nasce salvar_produto_com_grade + ACL; nenhuma linha muda no apply.
-- A versão é conferida DEPOIS de esperar a compra terminar, sob a ordem global
-- da 20261350000000: variações por id, depois produto. PRD01 recusa tudo.
-- A view vw_produtos_admin exige is_admin(); não filtra ativo/deleted_at.
-- Aqui também exigimos is_admin_atual() e recusamos produto excluído.
-- Exclusão com FK de pedido vai para recusadas; qualquer outro erro desfaz tudo.
-- Pré-voo: a função ausente (primeira aplicação) OU com o corpo desta migration (reaplicar); outro corpo = sucessora, recusa.
-- Estoque só grava com a versão conferida: patch com `estoque` ou variação existente com `stock_increment` exige base (22023).
-- ROLLBACK: rollback-manual-20261352000000_o_produto_e_a_grade_salvam_numa_transacao_so.sql
-- Voltar primeiro o front; rollback apaga só a porta nova, nunca dado.
-- Sem BEGIN/COMMIT: o aplicador controla a transação.
-- ============================================================================

DO $preflight_352$
DECLARE
  v_coluna text;
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL
     OR to_regprocedure('public.is_admin_atual()') IS NULL
     OR to_regclass('public.produtos') IS NULL
     OR to_regclass('public.product_variants') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: faltam tabelas ou guardas de admin.';
  END IF;
  FOREACH v_coluna IN ARRAY ARRAY[
    'id', 'ultima_atualizacao', 'deleted_at', 'nome', 'descricao', 'categoria', 'codigo',
    'custo', 'preco_venda', 'estoque', 'estoque_minimo', 'ativo', 'tags', 'imagem_url',
    'imagem_urls', 'meta_title', 'meta_description', 'preco_original', 'is_bestseller',
    'frete_gratis', 'codigo_barras', 'peso_kg', 'largura_cm', 'altura_cm', 'comprimento_cm'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.produtos'::regclass
      AND attname = v_coluna AND NOT attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta produtos.%', v_coluna;
    END IF;
  END LOOP;
  FOREACH v_coluna IN ARRAY ARRAY[
    'id', 'product_id', 'name', 'value', 'sku', 'codigo_barras',
    'price_override', 'active', 'image_url', 'stock_increment'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.product_variants'::regclass
      AND attname = v_coluna AND NOT attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: falta product_variants.%', v_coluna;
    END IF;
  END LOOP;
  -- Reaplicar reescreve o MESMO texto (CREATE OR REPLACE); sobrecarga ou corpo de sucessora recusam, sem escrever.
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
        AND proname = 'salvar_produto_com_grade') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: salvar_produto_com_grade tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])')
      AND md5(replace(prosrc, E'\r\n', E'\n')) <> '09c2a4b5724acbe46fb2c2e758e96c8f') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o corpo vivo de salvar_produto_com_grade não é o desta migration (sucessora no ar?) — não reaplique por cima.';
  END IF;
END $preflight_352$;

CREATE OR REPLACE FUNCTION public.salvar_produto_com_grade(
  p_produto_id uuid,
  p_base_atualizado_em timestamptz,
  p_produto jsonb,
  p_variantes jsonb,
  p_apagar uuid[]
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_atualizado_em timestamptz;
  v_chave text;
  v_item jsonb;
  v_id uuid;
  v_apagadas uuid[] := ARRAY[]::uuid[];
  v_recusadas uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  IF p_produto_id IS NULL OR jsonb_typeof(p_produto) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_variantes) IS DISTINCT FROM 'array' OR p_apagar IS NULL THEN
    RAISE EXCEPTION 'Produto, variantes e exclusões precisam ter o formato esperado.' USING ERRCODE = '22023';
  END IF;

  -- Estoque é dinheiro: sem a versão conferida (base nula) nenhum estoque absoluto de linha EXISTENTE é gravado.
  -- (Variação nova, sem id, só insere: não há venda a desfazer.)
  IF p_base_atualizado_em IS NULL
     AND (p_produto ? 'estoque'
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_variantes) e
                      WHERE jsonb_typeof(e) = 'object' AND e ? 'stock_increment' AND e->>'id' IS NOT NULL)) THEN
    RAISE EXCEPTION 'Estoque só é gravado com a versão do produto conferida.' USING ERRCODE = '22023';
  END IF;

  -- Ordem global de travas da 20261350000000: TODAS as variações do produto (por id) e só então o produto.
  PERFORM id FROM public.product_variants
    WHERE product_id = p_produto_id
    ORDER BY id FOR NO KEY UPDATE;
  SELECT ultima_atualizacao INTO v_atualizado_em
    FROM public.produtos
    WHERE id = p_produto_id AND deleted_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF p_base_atualizado_em IS NOT NULL
     AND v_atualizado_em IS DISTINCT FROM p_base_atualizado_em THEN
    RAISE EXCEPTION 'O produto mudou enquanto você editava. Recarregue a página e confira antes de salvar de novo.'
      USING ERRCODE = 'PRD01';
  END IF;

  FOR v_chave IN SELECT jsonb_object_keys(p_produto) LOOP
    IF NOT (v_chave = ANY(ARRAY[
      'nome', 'descricao', 'categoria', 'codigo', 'custo', 'preco_venda', 'estoque',
      'estoque_minimo', 'ativo', 'tags', 'imagem_url', 'imagem_urls', 'meta_title',
      'meta_description', 'preco_original', 'is_bestseller', 'frete_gratis',
      'codigo_barras', 'peso_kg', 'largura_cm', 'altura_cm', 'comprimento_cm'
    ])) THEN
      RAISE EXCEPTION 'Campo de produto não permitido: %', v_chave USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_produto <> '{}'::jsonb THEN
    UPDATE public.produtos SET
      nome = CASE WHEN p_produto ? 'nome' THEN p_produto->>'nome' ELSE nome END,
      descricao = CASE WHEN p_produto ? 'descricao' THEN p_produto->>'descricao' ELSE descricao END,
      categoria = CASE WHEN p_produto ? 'categoria' THEN p_produto->>'categoria' ELSE categoria END,
      codigo = CASE WHEN p_produto ? 'codigo' THEN p_produto->>'codigo' ELSE codigo END,
      custo = CASE WHEN p_produto ? 'custo' THEN (p_produto->>'custo')::numeric ELSE custo END,
      preco_venda = CASE WHEN p_produto ? 'preco_venda' THEN (p_produto->>'preco_venda')::numeric ELSE preco_venda END,
      estoque = CASE WHEN p_produto ? 'estoque' THEN (p_produto->>'estoque')::integer ELSE estoque END,
      estoque_minimo = CASE WHEN p_produto ? 'estoque_minimo' THEN (p_produto->>'estoque_minimo')::integer ELSE estoque_minimo END,
      ativo = CASE WHEN p_produto ? 'ativo' THEN (p_produto->>'ativo')::boolean ELSE ativo END,
      tags = CASE WHEN p_produto ? 'tags' THEN CASE WHEN p_produto->'tags' = 'null'::jsonb THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(p_produto->'tags')) END ELSE tags END,
      imagem_url = CASE WHEN p_produto ? 'imagem_url' THEN p_produto->>'imagem_url' ELSE imagem_url END,
      imagem_urls = CASE WHEN p_produto ? 'imagem_urls' THEN CASE WHEN p_produto->'imagem_urls' = 'null'::jsonb THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text(p_produto->'imagem_urls')) END ELSE imagem_urls END,
      meta_title = CASE WHEN p_produto ? 'meta_title' THEN p_produto->>'meta_title' ELSE meta_title END,
      meta_description = CASE WHEN p_produto ? 'meta_description' THEN p_produto->>'meta_description' ELSE meta_description END,
      preco_original = CASE WHEN p_produto ? 'preco_original' THEN (p_produto->>'preco_original')::numeric ELSE preco_original END,
      is_bestseller = CASE WHEN p_produto ? 'is_bestseller' THEN (p_produto->>'is_bestseller')::boolean ELSE is_bestseller END,
      frete_gratis = CASE WHEN p_produto ? 'frete_gratis' THEN (p_produto->>'frete_gratis')::boolean ELSE frete_gratis END,
      codigo_barras = CASE WHEN p_produto ? 'codigo_barras' THEN p_produto->>'codigo_barras' ELSE codigo_barras END,
      peso_kg = CASE WHEN p_produto ? 'peso_kg' THEN (p_produto->>'peso_kg')::numeric ELSE peso_kg END,
      largura_cm = CASE WHEN p_produto ? 'largura_cm' THEN (p_produto->>'largura_cm')::numeric ELSE largura_cm END,
      altura_cm = CASE WHEN p_produto ? 'altura_cm' THEN (p_produto->>'altura_cm')::numeric ELSE altura_cm END,
      comprimento_cm = CASE WHEN p_produto ? 'comprimento_cm' THEN (p_produto->>'comprimento_cm')::numeric ELSE comprimento_cm END
    WHERE id = p_produto_id;
  END IF;

  FOREACH v_id IN ARRAY p_apagar LOOP
    BEGIN
      DELETE FROM public.product_variants WHERE id = v_id AND product_id = p_produto_id;
      IF FOUND THEN v_apagadas := array_append(v_apagadas, v_id); END IF;
    EXCEPTION WHEN foreign_key_violation THEN
      v_recusadas := array_append(v_recusadas, v_id);
    END;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_variantes) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Variação precisa ser um objeto.' USING ERRCODE = '22023';
    END IF;
    IF v_item ? 'stock_increment' THEN
      IF v_item->>'stock_increment' IS NULL THEN
        RAISE EXCEPTION 'stock_increment não pode ser nulo.' USING ERRCODE = '22023';
      END IF;
    END IF;
    v_id := (v_item->>'id')::uuid;
    IF v_id IS NOT NULL THEN
      UPDATE public.product_variants SET
        name = v_item->>'name', value = v_item->>'value', sku = v_item->>'sku',
        codigo_barras = v_item->>'codigo_barras', price_override = (v_item->>'price_override')::numeric,
        active = (v_item->>'active')::boolean, image_url = v_item->>'image_url',
        stock_increment = CASE WHEN v_item ? 'stock_increment' THEN (v_item->>'stock_increment')::integer ELSE stock_increment END
      WHERE id = v_id AND product_id = p_produto_id;
      IF FOUND THEN CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_id) THEN
        RAISE EXCEPTION 'Variação pertence a outro produto: %', v_id USING ERRCODE = '22023';
      END IF;
    END IF;
    INSERT INTO public.product_variants
      (id, product_id, name, value, sku, codigo_barras, price_override, active, image_url, stock_increment)
    VALUES
      (COALESCE(v_id, extensions.uuid_generate_v4()), p_produto_id, v_item->>'name', v_item->>'value',
       v_item->>'sku', v_item->>'codigo_barras', (v_item->>'price_override')::numeric,
       (v_item->>'active')::boolean, v_item->>'image_url',
       CASE WHEN v_item ? 'stock_increment' THEN (v_item->>'stock_increment')::integer ELSE 0 END);
  END LOOP;

  SELECT ultima_atualizacao INTO v_atualizado_em FROM public.produtos WHERE id = p_produto_id;
  RETURN jsonb_build_object('ultima_atualizacao', v_atualizado_em, 'apagadas', to_jsonb(v_apagadas), 'recusadas', to_jsonb(v_recusadas));
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_produto_com_grade(uuid, timestamptz, jsonb, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_produto_com_grade(uuid, timestamptz, jsonb, jsonb, uuid[]) TO authenticated, service_role;

DO $postflight_352$
BEGIN
  IF NOT COALESCE((SELECT count(*) = 1 AND bool_and(prosecdef AND provolatile = 'v' AND NOT proisstrict
      AND prorettype = 'jsonb'::regtype AND proconfig = ARRAY['search_path=public']
      AND prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      AND md5(replace(prosrc, E'\r\n', E'\n')) = '09c2a4b5724acbe46fb2c2e758e96c8f'
      AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f', proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
    FROM pg_proc WHERE oid = to_regprocedure('public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])')), false)
    OR has_function_privilege('anon', 'public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo, atributos ou ACL de salvar_produto_com_grade divergentes.';
  END IF;
END $postflight_352$;

NOTIFY pgrst, 'reload schema';
