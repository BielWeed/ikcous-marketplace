-- Rollback manual da 20261385000000. Devolve get_admin_products_paged ao corpo da 20261381000000 byte a byte (LF),
-- mantendo OID, dono, atributos e ACL; nao toca em dados.
-- ATENCAO: reabre o defeito (a busca de produtos do painel volta a nao achar pelo codigo de barras nem pelo codigo da
-- variacao). O front nao precisa voltar.
-- O pre-voo exige o corpo da 20261385 (md5 39db382689def5fac3b263a66f84ede1): segundo rollback ou sucessora desconhecida recusa.
-- Depois dele o corpo e o da 20261381 (md5 d204becede7d249e0a1871038f854a46), que e o que o rollback da 20261381 exige.
-- Sem controle de transacao: o aplicador fornece a transacao inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261385$
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
    IF v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (hash %) nao e o corpo desta migration; revise antes de desfazer.', r.assinatura, COALESCE(v_hash, 'ausente');
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
END $preflight_rollback_20261385$;

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
          unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%')
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
              unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%')
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

DO $conferencia_rollback_20261385$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_admin_products_paged(text,text,text,text,integer,integer)')
      AND md5(replace(p.prosrc, E'\r', '')) = 'd204becede7d249e0a1871038f854a46'
      AND (to_jsonb(p) - 'prosrc') = current_setting('ikcous.busca385_atributos')::jsonb
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261385 falhou (corpo ou atributos alterados).';
  END IF;
END $conferencia_rollback_20261385$;

NOTIFY pgrst, 'reload schema';
