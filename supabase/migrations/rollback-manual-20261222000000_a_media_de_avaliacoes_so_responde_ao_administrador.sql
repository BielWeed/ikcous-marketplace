-- ============================================================================
-- Rollback manual — a média de avaliações só responde ao administrador
-- (20261222000000)
-- ============================================================================
-- Recria `get_reviews_metrics(text, integer)` com o corpo ANTIGO, sem a guarda de admin
-- (o corpo da baseline 20260806000000, byte a byte: o md5 de `replace(prosrc, E'\r', '')`
-- volta a ser o de antes, e a prova viva confere). Assinatura, SECURITY DEFINER,
-- `search_path`, volatilidade e tipo de retorno são os mesmos da migration.
--
-- A ACL NÃO é tocada: `CREATE OR REPLACE` preserva dono e privilégios, e este arquivo não
-- tem nenhum GRANT nem REVOKE — nunca devolve EXECUTE a anon ou a PUBLIC. Se a 20261221000000
-- está aplicada, a função continua fechada ao visitante.
--
-- COM ELE VOLTA O DEFEITO: qualquer conta LOGADA (não só o admin) volta a ler a média e as
-- contagens de TODAS as avaliações, as pendentes incluídas.
--
-- DADOS: nenhuma linha foi reescrita pela migration nem é tocada aqui.
--
-- PRÉ-VOO: recusa (`B1_BASELINE_DIVERGENT`) se a função não existir ou tiver sobrecarga; se
-- o corpo vivo não for um dos dois conhecidos (o novo, com guarda, ou o antigo, e então
-- rodar de novo reescreve o mesmo texto) — reescrever por cima de um corpo desconhecido
-- apagaria uma redefinição que ninguém revisou; se os atributos não forem os de sempre; ou
-- se PUBLIC tiver EXECUTE ou authenticated/service_role não tiverem (o estado de antes
-- nunca teve PUBLIC). A conferência final recusa se o corpo não voltou ao antigo, se algum
-- atributo mudou ou se PUBLIC passou a executar.
--
-- ORDEM: este vem ANTES do rollback da 20261221000000, se os dois forem rodados.
-- ATENÇÃO — NÃO RODE depois deste arquivo o
-- `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql`: ele faz
-- `GRANT EXECUTE ... TO PUBLIC` nesta função e reabre a média para TODOS, inclusive o
-- visitante, agora SEM guarda no corpo.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma
-- transação). Sem BEGIN/COMMIT de nível superior neste arquivo — regra da casa. Rodar duas
-- vezes deixa o mesmo estado.
-- ============================================================================

DO $preflight_rollback_20261222$
DECLARE
  v_fn CONSTANT text := 'public.get_reviews_metrics(text,integer)';
  v_oid oid := to_regprocedure('public.get_reviews_metrics(text,integer)');
  v_hash text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe — nada a devolver.', v_fn;
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_reviews_metrics') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: get_reviews_metrics tem sobrecarga em public — revise antes de devolver o corpo antigo.';
  END IF;

  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'f7fb638c20dce1ae26509f4ffc563120' AND v_hash IS DISTINCT FROM 'cb41947ab5a8075cea87ab123913b10d' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o novo (com guarda) nem o antigo — uma redefinição posterior está no ar; revise antes de sobrescrever.', v_fn, COALESCE(v_hash, 'ausente');
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer'
          AND pg_get_function_result(p.oid) = 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % não são os conhecidos — revise antes de sobrescrever.', v_fn;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % está aberta para PUBLIC — o estado de antes nunca teve PUBLIC; revise a ACL antes.', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: authenticated ou service_role sem EXECUTE em % — revise a ACL antes.', v_fn;
  END IF;
END $preflight_rollback_20261222$;

CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)
 RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_search_pattern text;
  v_profile_ids uuid[];
  v_product_ids uuid[];
BEGIN
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
$$;

DO $conferencia_rollback_20261222$
DECLARE
  v_fn CONSTANT text := 'public.get_reviews_metrics(text,integer)';
  v_oid oid := to_regprocedure('public.get_reviews_metrics(text,integer)');
  v_hash text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
  IF v_hash IS DISTINCT FROM 'f7fb638c20dce1ae26509f4ffc563120' THEN
    RAISE EXCEPTION 'conferencia rollback 20261222: corpo vivo de % (hash %) não voltou ao antigo', v_fn, COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid
          AND l.lanname = 'plpgsql'
          AND p.prosecdef
          AND p.provolatile = 'v'
          AND p.proretset
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_arguments(p.oid) = 'p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer'
          AND pg_get_function_result(p.oid) = 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)'
     ) THEN
    RAISE EXCEPTION 'conferencia rollback 20261222: atributos de % mudaram', v_fn;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia rollback 20261222: % aberta para PUBLIC — o estado de antes não tinha PUBLIC', v_fn;
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'conferencia rollback 20261222: authenticated ou service_role sem EXECUTE em %', v_fn;
  END IF;
END $conferencia_rollback_20261222$;
