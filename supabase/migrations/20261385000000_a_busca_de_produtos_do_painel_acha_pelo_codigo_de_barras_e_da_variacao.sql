-- A BUSCA DE PRODUTOS DO PAINEL ACHA PELO CODIGO DE BARRAS E PELO CODIGO DA VARIACAO (painel-admin-3; 23/10/2026).
-- DEFEITO: na lista de Produtos do painel, digitar o codigo de barras de um produto, ou o codigo de barras / SKU de uma
-- variacao (cor/tamanho), nao acha nada. A busca roda no banco: o front manda o texto como p_search para
-- get_admin_products_paged (src/hooks/useProducts.ts, a lista e o carregamento completo; src/views/admin/AdminPdvView.tsx,
-- a busca manual do balcao) e o filtro so olhava o nome e o codigo (produtos.codigo).
--
-- O QUE MUDA, SO ISTO: o filtro de busca ganha tres ramos em OU com os dois de hoje (nome, codigo), nos DOIS blocos da
-- funcao (o total_count e a pagina), com o MESMO texto, senao a paginacao erra:
--   * produtos.codigo_barras = texto            IGUALDADE, nunca parcial: um EAN pode ser prefixo de outro (a RPC
--                                               buscar_por_codigo_barras, 20261161000000, ja compara por igualdade);
--   * product_variants.codigo_barras = texto    IGUALDADE, so de variacao ATIVA do produto (active = true);
--   * product_variants.sku ILIKE unaccent(%texto%)  o MESMO criterio do produtos.codigo de hoje, so de variacao ativa.
-- As variacoes entram por EXISTS (nao por JOIN): o produto sai UMA vez no total e na pagina, mesmo com varias variacoes
-- casando. O indice idx_product_variants_product_id serve o EXISTS; nenhum objeto novo (sem indice, coluna ou tabela).
-- Texto vazio continua sem filtro. As demais clausulas (categoria, status, estoque baixo, deleted_at) e o ORDER BY ficam como
-- estao. Assinatura, retorno (data com as variacoes de cada produto + total_count), SECURITY DEFINER, search_path, volatilidade,
-- dono, OID e GRANTs (EXECUTE so authenticated e service_role) NAO mudam; o gate is_admin_atual() da 20261381000000 fica no
-- topo, intacto. O front nao muda: so passa a receber resultado onde antes recebia lista vazia.
--
-- DADOS EXISTENTES: nenhuma linha e lida ou escrita. E so a leitura que muda; produto sem codigo de barras (NULL) nunca casa
-- (NULL = texto e NULL), e com texto vazio o ramo nem e avaliado.
--
-- CORPO VIGENTE: o da 20261381000000 (md5 d204becede7d249e0a1871038f854a46) com UMA edicao em cada um dos dois blocos do filtro; o corpo
-- desta migration tem md5 39db382689def5fac3b263a66f84ede1. PRE-VOO fail-closed: aceita SO o corpo da 20261381 ou o desta (reaplicar e
-- inofensivo), mais atributos, dono, ACL e uma assinatura so; exige tambem as colunas que o filtro novo le (plpgsql nao
-- valida coluna ao criar a funcao: sem a 20261160000000 a lista inteira passaria a falhar em toda chamada). Loja que ainda
-- nao recebeu a 20261381 e recusada de proposito: aplicar na ordem. POS-VOO: hash novo e fotografia de TODOS os atributos
-- tirada antes igual a de depois (so o texto muda). Sem BEGIN/COMMIT de nivel superior: o aplicador fornece a transacao
-- inteira (AGENTS.md); se qualquer verificacao falhar, nada fica gravado.
-- ORDEM: depois da 20261381000000 e da 20261160000000. COMPORTAMENTO: tests/banco/busca-do-painel-por-codigo-viva.cjs (so CI efemero).
-- ROLLBACK MANUAL: rollback-manual-20261385000000_a_busca_de_produtos_do_painel_acha_pelo_codigo_de_barras_e_da_variacao.sql
-- devolve o corpo da 20261381 byte a byte (LF, sem CR); recusa corpo desconhecido e segundo rollback. Desfazer a 20261381
-- exige desfazer esta ANTES (o rollback da 81 so aceita o corpo dela).
--

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261385$
DECLARE
  r record;
  v_hash text;
  v_atributos jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.get_admin_products_paged(text,text,text,text,integer,integer)', 'd204becede7d249e0a1871038f854a46', '39db382689def5fac3b263a66f84ede1')
  ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(p.prosrc, E'\r', '')), to_jsonb(p) - 'prosrc'
      INTO v_hash, v_atributos FROM pg_proc p
     WHERE p.oid = to_regprocedure(r.assinatura);
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo vigente (20261381) nem o desta migration; revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = to_regprocedure(r.assinatura)
         AND p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
         AND p.provolatile = 'v' AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
         AND p.proparallel = 'u' AND p.procost = 100
         AND l.lanname = 'plpgsql' AND p.prorettype = 'jsonb'::regtype
         AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_category text DEFAULT ''all''::text, p_status text DEFAULT ''all''::text, p_stock text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10'
         AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
         AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_products_paged') = 1
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_products_paged tem assinatura, atributos, dono ou permissoes diferentes dos esperados.';
    END IF;
    -- Fotografia de OID, dono, ACL e TODOS os atributos: o CREATE OR REPLACE so pode trocar prosrc.
    PERFORM set_config('ikcous.busca385_atributos', v_atributos::text, true);
  END LOOP;
  -- As colunas que o filtro novo le. plpgsql NAO valida coluna ao criar a funcao: sem esta guarda, uma loja sem a
  -- 20261160000000 aceitaria o CREATE e a lista inteira de Produtos passaria a falhar em TODA chamada.
  IF (SELECT count(*) FROM pg_attribute a
       WHERE NOT a.attisdropped
         AND ((a.attrelid = to_regclass('public.produtos') AND a.attname = 'codigo_barras' AND a.atttypid = 'text'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'codigo_barras' AND a.atttypid = 'text'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'sku' AND a.atttypid = 'text'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'active' AND a.atttypid = 'boolean'::regtype)
           OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'product_id' AND a.atttypid = 'uuid'::regtype))) <> 5 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: produtos.codigo_barras, product_variants.codigo_barras, sku, active e product_id precisam existir com o tipo esperado (20261160000000); nada foi alterado.';
  END IF;
END $preflight_20261385$;

CREATE OR REPLACE FUNCTION public.get_admin_products_paged(p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_stock text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Compute total count with filters (before pagination)
    SELECT COUNT(p.id) INTO v_total_count
    FROM public.produtos p
    WHERE p.deleted_at IS NULL
      AND (p_category = 'all' OR p.categoria = p_category)
      AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
      AND (p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))
      AND (
        v_clean_search = '' OR (
          unaccent(p.nome) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%') OR
          -- Codigo de barras: IGUALDADE (um EAN pode ser prefixo de outro), do produto ou de uma variacao ATIVA;
          -- o SKU da variacao segue o criterio do codigo do produto acima.
          p.codigo_barras = v_clean_search OR
          EXISTS (
            SELECT 1 FROM public.product_variants vc
             WHERE vc.product_id = p.id AND vc.active
               AND (vc.codigo_barras = v_clean_search
                    OR unaccent(vc.sku) ILIKE unaccent('%' || v_clean_search || '%'))
          )
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            p.*,
            (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(v.*)),
                    '[]'::JSONB
                )
                FROM public.product_variants v
                WHERE v.product_id = p.id
            ) AS product_variants
        FROM public.produtos p
        WHERE p.deleted_at IS NULL
          AND (p_category = 'all' OR p.categoria = p_category)
          AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
          AND (p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))
          AND (
            v_clean_search = '' OR (
              unaccent(p.nome) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%') OR
              -- Codigo de barras: IGUALDADE (um EAN pode ser prefixo de outro), do produto ou de uma variacao ATIVA;
              -- o SKU da variacao segue o criterio do codigo do produto acima.
              p.codigo_barras = v_clean_search OR
              EXISTS (
                SELECT 1 FROM public.product_variants vc
                 WHERE vc.product_id = p.id AND vc.active
                   AND (vc.codigo_barras = v_clean_search
                        OR unaccent(vc.sku) ILIKE unaccent('%' || v_clean_search || '%'))
              )
            )
          )
        ORDER BY p.data_cadastro DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$function$;

DO $conferencia_20261385$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_admin_products_paged(text,text,text,text,integer,integer)')
      AND md5(replace(p.prosrc, E'\r', '')) = '39db382689def5fac3b263a66f84ede1'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.busca385_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia 20261385 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_20261385$;

NOTIFY pgrst, 'reload schema';
