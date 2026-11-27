-- ============================================================================
-- Rollback manual — uma avaliação por cliente e produto, e a média do painel só das publicadas (20261641000000)
-- ============================================================================
-- Tira o gatilho `tr_avaliacao_uma_por_cliente_e_produto` (em public.reviews) e a função
-- `public.avaliacao_uma_por_cliente_e_produto()` (os dois eram NOVOS) e devolve, byte a byte (LF, sem CR):
--   * `get_admin_reviews_paged` ao corpo da 20261399996000 (md5 75f5c48de4eb4005a2516e54b3d33135);
--   * `get_reviews_metrics` ao corpo da 20261381000000 (md5 71a40c86c6c1b23fbf991d653c746091).
-- CREATE OR REPLACE nas duas: OID, dono, ACL e atributos ficam (a conferência compara com a fotografia do pré-voo).
--
-- COM ELE VOLTAM OS DEFEITOS: a mesma cliente volta a poder avaliar o mesmo produto de novo pela API, e o topo do
-- painel volta a somar as pendentes.
--
-- DADOS: nenhuma linha de `reviews` é lida para reescrita, reescrita ou apagada. As avaliações gravadas enquanto a
-- trava existiu ficam como foram gravadas.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) antes de escrever se alguma das duas RPCs tiver corpo que não seja o desta
-- migration nem o de antes (sucessora desconhecida no ar), outros argumentos, atributos/dono/ACL diferentes ou
-- sobrecarga; ou se a função do gatilho existir com corpo desconhecido, ou o gatilho de mesmo nome não for o
-- desenhado. Estados aceitos: a migration no ar, ou já desfeita (rodar duas vezes deixa o mesmo estado).
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261641000000$
DECLARE
  v_paged oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
  v_metrics oid := to_regprocedure('public.get_reviews_metrics(text,integer)');
  v_gfn oid := to_regprocedure('public.avaliacao_uma_por_cliente_e_produto()');
  v_gat record;
BEGIN

  IF (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_reviews_paged') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged precisa existir com UMA assinatura so, e ha zero ou mais de uma; revise antes de desfazer.';
  END IF;
  IF v_paged IS NULL
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_paged) NOT IN ('21ba271d66edd776cab2443d32800db7', '75f5c48de4eb4005a2516e54b3d33135')
     OR pg_get_function_arguments(v_paged) <> 'p_search text DEFAULT ''''::text, p_rating text DEFAULT ''all''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT ''todas''::text' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_admin_reviews_paged não tem o corpo desta migration nem o da 20261399996000 (uma sucessora desconhecida está no ar); revise antes de desfazer.';
  END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = v_paged
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

  IF (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_reviews_metrics') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_reviews_metrics precisa existir com UMA assinatura so, e ha zero ou mais de uma; revise antes de desfazer.';
  END IF;
  IF v_metrics IS NULL
     OR (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_metrics) NOT IN ('971268999fce410628356d65b99fbca5', '71a40c86c6c1b23fbf991d653c746091')
     OR pg_get_function_arguments(v_metrics) <> 'p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_reviews_metrics não tem o corpo desta migration nem o da 20261381000000; revise antes de desfazer.';
  END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = v_metrics
         AND p.prokind = 'f' AND p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
         AND p.proconfig = ARRAY['search_path=public']::text[]
         AND pg_get_function_result(p.oid) = 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)' AND p.proretset
         AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel = 'u' AND p.procost = 100
         AND p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_reviews_metrics tem atributos, dono ou permissoes diferentes dos esperados.';
    END IF;

  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_uma_por_cliente_e_produto') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_uma_por_cliente_e_produto tem sobrecarga em public — revise antes de desfazer.';
  END IF;
  IF v_gfn IS NOT NULL THEN
    IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_gfn) IS DISTINCT FROM 'a84f4bc295a088c75ad926f43e16c39d' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.avaliacao_uma_por_cliente_e_produto() já existe com corpo desconhecido — ninguém revisou essa redefinição; revise antes de desfazer.';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_uma_por_cliente_e_produto') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: avaliacao_uma_por_cliente_e_produto existe em public com outra assinatura — revise antes de desfazer.';
  END IF;

  FOR v_gat IN
    SELECT t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs, t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname = 'tr_avaliacao_uma_por_cliente_e_produto'
  LOOP
    IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.reviews')
       OR v_gat.tgfoid IS DISTINCT FROM v_gfn
       OR v_gat.tgtype <> 7
       OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.attr <> '' OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho chamado tr_avaliacao_uma_por_cliente_e_produto que NÃO é o desenhado pela 20261641000000 (outra tabela, outra função, outro momento/evento, WHEN, UPDATE OF ou argumentos) — revise antes de desfazer.';
    END IF;
  END LOOP;
  PERFORM set_config('ikcous.avaliacoes3641_paged', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_paged)::text, true);
  PERFORM set_config('ikcous.avaliacoes3641_metrics', (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_metrics)::text, true);
END $preflight_rollback_20261641000000$;

DROP TRIGGER IF EXISTS tr_avaliacao_uma_por_cliente_e_produto ON public.reviews;

DROP FUNCTION IF EXISTS public.avaliacao_uma_por_cliente_e_produto();

-- O corpo da 20261399996000, byte a byte (md5 75f5c48de4eb4005a2516e54b3d33135).
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
    v_so_sem_resposta BOOLEAN;
    
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
    -- Filtro de resposta (20261399996000): so o texto 'sem_resposta' liga este filtro, pela MESMA regra do sino do painel
    -- (src/lib/avaliacoes-para-atender.ts): sem resposta = merchant_reply IS NULL. Resposta em branco NAO conta como sem resposta.
    v_so_sem_resposta := COALESCE(p_status = 'sem_resposta', false);
    
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
      AND (NOT v_so_sem_resposta OR r.merchant_reply IS NULL)
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
          AND (NOT v_so_sem_resposta OR r.merchant_reply IS NULL)
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

-- O corpo da 20261381000000, byte a byte (md5 71a40c86c6c1b23fbf991d653c746091).
CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)
 RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_search_pattern text;
  v_profile_ids uuid[];
  v_product_ids uuid[];
BEGIN
  -- Só o administrador lê a média e as contagens de TODAS as avaliações (as pendentes
  -- entram na conta). Mesma guarda da irmã get_admin_reviews_paged.
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
  END IF;

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_search_pattern := '%' || p_search || '%';
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_profile_ids 
    FROM public_profiles 
    WHERE full_name ILIKE v_search_pattern;
    
    SELECT COALESCE(array_agg(id), '{}') INTO v_product_ids 
    FROM produtos 
    WHERE nome ILIKE v_search_pattern;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(AVG(r.rating), 0.0)::numeric as average_rating,
    COUNT(CASE WHEN r.verified = true THEN 1 END)::bigint as total_verified,
    COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)::bigint as total_replied
  FROM reviews r
  WHERE 
    (p_rating IS NULL OR r.rating = p_rating)
    AND (
      p_search IS NULL OR p_search = '' 
      OR r.comment ILIKE v_search_pattern
      OR (v_profile_ids IS NOT NULL AND r.user_id = ANY(v_profile_ids))
      OR (v_product_ids IS NOT NULL AND r.product_id = ANY(v_product_ids))
    );
END;
$function$;

DO $conferencia_rollback_20261641000000$
DECLARE
  v_paged oid := to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)');
  v_metrics oid := to_regprocedure('public.get_reviews_metrics(text,integer)');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'tr_avaliacao_uma_por_cliente_e_produto') THEN
    RAISE EXCEPTION 'conferencia rollback 20261641000000: o gatilho ainda existe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'avaliacao_uma_por_cliente_e_produto') THEN
    RAISE EXCEPTION 'conferencia rollback 20261641000000: a função do gatilho ainda existe';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_paged) IS DISTINCT FROM '75f5c48de4eb4005a2516e54b3d33135'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_metrics) IS DISTINCT FROM '71a40c86c6c1b23fbf991d653c746091' THEN
    RAISE EXCEPTION 'conferencia rollback 20261641000000: os corpos de antes não voltaram byte a byte';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_paged) IS DISTINCT FROM current_setting('ikcous.avaliacoes3641_paged')::jsonb
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_metrics) IS DISTINCT FROM current_setting('ikcous.avaliacoes3641_metrics')::jsonb THEN
    RAISE EXCEPTION 'conferencia rollback 20261641000000: OID, dono, ACL ou atributo de uma das RPCs mudou';
  END IF;
END $conferencia_rollback_20261641000000$;

NOTIFY pgrst, 'reload schema';
