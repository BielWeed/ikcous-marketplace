-- ============================================================================
-- Migration 20261395100000 — a grade antiga não ressuscita variação excluída (painel de produto; estoque; troca o corpo de UMA função)
-- ============================================================================
--
-- 1. O DEFEITO MEDIDO (caça 9, 26/10/2026; reconfirmado no corpo vivo)
--
-- public.salvar_produto_com_grade(p_produto_id, p_base_atualizado_em, p_produto, p_variantes, p_apagar) grava o produto e a grade
-- numa transação só. Para cada variação que a tela manda COM id, ela faz UPDATE ... WHERE id = v_id AND product_id = p_produto_id; se
-- nenhuma linha muda e o id não existe em outro produto, a função seguia para o INSERT — e esse INSERT usa o MESMO id
-- (COALESCE(v_id, uuid_generate_v4())). Uma variação que a lojista (ou outro aparelho) EXCLUIU, e que ainda estava na grade de uma
-- tela aberta antes, voltava a existir, com o estoque e o preço da tela velha. A conferência de versão (p_base_atualizado_em) só
-- protege quando o estoque foi mexido: salvar só o nome do produto, com a grade antiga junto, não passava por ela. Também voltava a
-- variação que estava ao mesmo tempo em p_apagar e em p_variantes (apaga e recria).
-- A tela NUNCA manda id de variação nova (src/hooks/useProducts.ts: variacoesParaBanco descarta o id "temp-..."): variação nova vai sem
-- id e o banco sorteia o dele. Portanto um id que não existe em lugar nenhum só chega aqui como reenvio de grade antiga.
--
-- 2. A REGRA NOVA
--
-- Id informado que não existe em nenhum produto: a função PULA essa variação (não grava, não recria, não erra) e segue com as outras.
-- O contrato fica o mesmo: mesma assinatura, mesmos campos de retorno (ultima_atualizacao, apagadas, recusadas), mesmos erros. O que
-- a pessoa vê: ao salvar, o produto recarrega (fetchProduct) e a variação excluída continua excluída. Variação que EXISTE neste
-- produto atualiza como sempre; variação de OUTRO produto continua recusando (22023); variação nova (sem id) continua inserindo.
-- DECISÃO DE PRODUTO EM ABERTO (não tomada aqui): pular em silêncio ou recusar o salvamento com "recarregue" (PRD01). Escolhido pular
-- porque é o menor desvio do comportamento de hoje (o resto do salvamento não se perde) e nunca grava o que a tela velha pediu.
--
-- 3. O QUE MUDA NO CORPO (só esta troca; o resto não muda um byte)
--
-- Dentro do "IF v_id IS NOT NULL THEN", depois da recusa "Variação pertence a outro produto", entra um CONTINUE com 4 linhas de
-- comentário. Assinatura, SECURITY DEFINER, VOLATILE, search_path, ACL (authenticated e service_role) e as travas (variações por id,
-- depois o produto) NÃO mudam.
--
-- 4. DADOS EXISTENTES
--
-- Nenhuma linha é lida nem reescrita ao aplicar: só o corpo de UMA função muda. Variações que já foram ressuscitadas antes ficam como
-- estão (não há como distinguir). Aplicar duas vezes deixa o mesmo estado.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se: a função não existir ou tiver sobrecarga; o corpo vivo (md5 de replace(prosrc, E'\r', '')) não for UM dos dois conhecidos
-- (o da 20261352000000, 09c2a4b5724acbe46fb2c2e758e96c8f, ou o desta migration, 10fc8c0f1e305666b39e5f1f383815e2); os atributos não forem os de sempre; ou a ACL
-- não for EXATAMENTE a de hoje. Fotografa OID, dono, ACL e atributos para o pós-voo.
--
-- 6. TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa): quem abre a transação é o aplicador.
--
-- 7. ORDEM E ROLLBACK
--
-- Depois da 20261352000000 (o pré-voo recusa sem ela). A 20261352000000 NÃO deve ser reaplicada por cima desta (o pré-voo dela
-- recusa corpo de sucessora). ROLLBACK MANUAL: rollback-manual-20261395100000_a_grade_antiga_nao_ressuscita_variacao_excluida.sql devolve o corpo da 20261352000000 byte a
-- byte; vem ANTES do rollback da 20261352000000 (que apaga a função).
--
-- 8. FICHA DE VERIFICAÇÃO
--
--   1. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])');
--      -- esperado: 10fc8c0f1e305666b39e5f1f383815e2.
--   2. proacl, prosecdef e proconfig iguais antes e depois.
--   PROVA VIVA: tests/banco/a-grade-antiga-nao-ressuscita-variacao-excluida-viva.cjs (rpc-ci); portão da release: consultas 109a e 109b.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261395100000$
DECLARE
  v_fn CONSTANT text := 'public.salvar_produto_com_grade(uuid, timestamptz, jsonb, jsonb, uuid[])';
  v_oid oid := to_regprocedure('public.salvar_produto_com_grade(uuid, timestamptz, jsonb, jsonb, uuid[])');
  v_hash text;
  v_vigente text;
  v_desta text;
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'salvar_produto_com_grade') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: salvar_produto_com_grade tem sobrecarga em public — meça a loja e revise antes de aplicar.';
  END IF;

  -- vigente = o corpo da 20261352000000 (até aqui); desta = o que ESTA migration deixa (reaplicação idempotente).
  SELECT anterior, desta INTO v_vigente, v_desta FROM (VALUES
    ('public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])', '09c2a4b5724acbe46fb2c2e758e96c8f', '10fc8c0f1e305666b39e5f1f383815e2')
  ) esperado(assinatura, anterior, desta);
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS NULL OR v_hash NOT IN (v_vigente, v_desta) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente (20261352000000) nem o que esta migration deixa — capture o corpo vivo e revise antes de aplicar.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND p.pronargs = 5
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_produto_id uuid, p_base_atualizado_em timestamp with time zone, p_produto jsonb, p_variantes jsonb, p_apagar uuid[]'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', v_fn;
  END IF;

  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a conhecida (authenticated e service_role sim; anon e PUBLIC não) — meça a loja e revise.', v_fn;
  END IF;

  -- Fotografia: OID, dono, ACL e TODOS os atributos (o CREATE OR REPLACE só pode trocar o texto).
  PERFORM set_config('ikcous.grade395_atributos', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_20261395100000$;

-- salvar_produto_com_grade: o corpo vivo da 20261352000000 + a troca declarada no cabeçalho (item 3).
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
      -- 20261395100000: variacao que alguem excluiu depois que esta tela abriu NAO renasce. Um id que nao existe em lugar nenhum
      -- so chega aqui como reenvio de uma grade antiga (a tela nunca manda id de variacao nova: manda sem id, e o banco sorteia o
      -- proprio). O INSERT abaixo, com esse id, trazia a variacao de volta com o estoque da tela velha. Segue para a proxima.
      CONTINUE;
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

DO $posvoo_20261395100000$
DECLARE
  v_fn CONSTANT text := 'public.salvar_produto_com_grade(uuid, timestamptz, jsonb, jsonb, uuid[])';
  v_oid oid := to_regprocedure('public.salvar_produto_com_grade(uuid, timestamptz, jsonb, jsonb, uuid[])');
  v_hash text;
  v_src text;
  v_marca text := '20261395100000: variacao que alguem excluiu';
  v_public boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'POSVOO_20261395100000: % sumiu', v_fn;
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')), prosrc INTO v_hash, v_src FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM '10fc8c0f1e305666b39e5f1f383815e2' THEN
    RAISE EXCEPTION 'POSVOO_20261395100000: corpo vivo (hash %) não é o desta migration', COALESCE(v_hash, 'ausente');
  END IF;
  IF (length(v_src) - length(replace(v_src, v_marca, ''))) / length(v_marca) <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261395100000: a troca desta migration não aparece exatamente uma vez';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'salvar_produto_com_grade') <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261395100000: salvar_produto_com_grade ficou com sobrecarga';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prokind = 'f'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND NOT p.proisstrict
          AND p.pronargs = 5
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_produto_id uuid, p_base_atualizado_em timestamp with time zone, p_produto jsonb, p_variantes jsonb, p_apagar uuid[]'
          AND pg_get_function_result(p.oid) = 'jsonb'
     ) THEN
    RAISE EXCEPTION 'POSVOO_20261395100000: atributos de % mudaram', v_fn;
  END IF;
  v_public := EXISTS (SELECT 1 FROM pg_proc p
                        CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                       WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261395100000: ACL de % não é a de sempre', v_fn;
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.grade395_atributos')::jsonb THEN
    RAISE EXCEPTION 'POSVOO_20261395100000: atributos, dono, OID ou ACL de % mudaram', v_fn;
  END IF;
END $posvoo_20261395100000$;

-- A função é RPC chamada pelo PostgREST: recarrega o schema cache. Idempotente.
NOTIFY pgrst, 'reload schema';
