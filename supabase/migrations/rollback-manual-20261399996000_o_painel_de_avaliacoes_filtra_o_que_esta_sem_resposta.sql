-- Rollback manual da 20261399996000. Devolve o corpo VIVO da 20261399700000 (md5 af5d21345d167ca44dd327a93f949ea6) byte a byte (LF) em
-- get_admin_reviews_paged de 5 argumentos: o filtro "Sem resposta" (p_status = 'sem_resposta') deixa de existir no banco; o texto
-- passa a valer 'todas' (valor desconhecido nunca da erro), entao a tela filtrada mostra TODAS as avaliacoes ate o front voltar.
-- Nao toca em dados, na assinatura, no dono nem na ACL (CREATE OR REPLACE preserva o OID).
-- O pre-voo exige a funcao de 5 argumentos com o corpo da 20261399996000 (e nenhuma outra assinatura): segundo rollback, corpo
-- desconhecido ou sucessora desconhecida recusa com B1_BASELINE_DIVERGENT antes de escrever.
-- Sem controle de transacao: o aplicador fornece a transacao inteira.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261399996000$
DECLARE
  v_oid oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
  v_hash text;
  v_args text;
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_reviews_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged precisa existir com UMA assinatura so, a de 5 argumentos, e ha zero ou duas; revise antes de desfazer.';
  END IF;
  SELECT md5(replace(p.prosrc, E'\r', '')), pg_get_function_arguments(p.oid)
    INTO v_hash, v_args FROM pg_proc p WHERE p.oid = v_oid;
  IF v_hash <> '75f5c48de4eb4005a2516e54b3d33135' OR v_args <> 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT ''todas''::text' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged (hash %) nao e a de 5 argumentos com o corpo da migration 20261399996000; revise antes de desfazer.', v_hash;
  END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = v_oid
         AND p.prokind = 'f' AND p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
         AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
         AND pg_get_function_result(p.oid) = 'jsonb' AND NOT p.proretset
         AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel = 'u' AND p.procost = 100
         AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged tem atributos, dono ou permissoes diferentes dos esperados.';
    END IF;
  PERFORM set_config('ikcous.avaliacoes3996_estado', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)::text, true);
END $preflight_rollback_20261399996000$;

CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(p_search text DEFAULT ''::text, p_rating text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT 'todas'::text)
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
    v_rating_val INTEGER;
    v_so_pendentes BOOLEAN;
    
    -- Metrics
    v_average_rating NUMERIC;
    v_total_verified BIGINT;
    v_total_replied BIGINT;
    -- Globais de verdade (achado 5 da auditoria): mesmas metricas SEM o
    -- WHERE do filtro - os cartoes "Global/no total" param de seguir o filtro.
    v_global_total_count BIGINT;
    v_global_average_rating NUMERIC;
    v_global_total_verified BIGINT;
    v_global_total_replied BIGINT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin_atual() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    -- Filtro de moderacao (20261399700000): so o texto 'pendente' liga o filtro. NULL, 'todas' e qualquer
    -- outro texto valem 'todas' (o mesmo de antes): nunca erro, e o texto nunca entra em SQL montado.
    v_so_pendentes := COALESCE(p_status = 'pendente', false);
    
    IF p_rating = 'all' THEN
        v_rating_val := NULL;
    ELSE
        v_rating_val := p_rating::INTEGER;
    END IF;

    -- Compute total count and metrics in a single query block
    SELECT 
        COUNT(r.id),
        COALESCE(AVG(r.rating), 0.0),
        COUNT(CASE WHEN r.verified = true THEN 1 END),
        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)
    INTO 
        v_total_count,
        v_average_rating,
        v_total_verified,
        v_total_replied
    FROM public.reviews r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.produtos prod ON prod.id = r.product_id
    WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
      AND (NOT v_so_pendentes OR r.status = 'pendente')
      AND (
        v_clean_search = '' OR (
          unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Metricas GLOBAIS (sem filtro) - irmas das filtradas acima
    SELECT
        COUNT(r.id),
        COALESCE(AVG(r.rating), 0.0),
        COUNT(CASE WHEN r.verified = true THEN 1 END),
        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)
    INTO
        v_global_total_count,
        v_global_average_rating,
        v_global_total_verified,
        v_global_total_replied
    FROM public.reviews r;

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            r.*,
            (
                SELECT jsonb_build_object('full_name', p.full_name)
                FROM public.profiles p
                WHERE p.id = r.user_id
            ) AS "user",
            (
                SELECT jsonb_build_object('nome', prod.nome)
                FROM public.produtos prod
                WHERE prod.id = r.product_id
            ) AS "product"
        FROM public.reviews r
        LEFT JOIN public.profiles p ON p.id = r.user_id
        LEFT JOIN public.produtos prod ON prod.id = r.product_id
        WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
          AND (NOT v_so_pendentes OR r.status = 'pendente')
          AND (
            v_clean_search = '' OR (
              unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY r.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'average_rating', v_average_rating,
        'total_verified', v_total_verified,
        'total_replied', v_total_replied,
        'global_total_count', v_global_total_count,
        'global_average_rating', v_global_average_rating,
        'global_total_verified', v_global_total_verified,
        'global_total_replied', v_global_total_replied
    );
END;
$function$;

DO $conferencia_rollback_20261399996000$
DECLARE
  v_oid oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_reviews_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261399996000 falhou (a assinatura de 5 argumentos nao existe sozinha).';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
      AND md5(replace(p.prosrc, E'\r', '')) = 'af5d21345d167ca44dd327a93f949ea6'
      AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT ''todas''::text'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261399996000 falhou (corpo ou argumentos alterados).';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM current_setting('ikcous.avaliacoes3996_estado')::jsonb THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: conferencia do rollback 20261399996000 falhou (OID, dono, ACL ou atributo mudou).';
  END IF;
END $conferencia_rollback_20261399996000$;

NOTIFY pgrst, 'reload schema';
