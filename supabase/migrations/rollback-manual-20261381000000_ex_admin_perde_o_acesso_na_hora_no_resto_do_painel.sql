-- Rollback manual da 20261381000000. So metadados: nenhum dado e alterado.
-- Exige o estado EXATO desta migration antes de escrever (recusa estado desconhecido e repeticao).
-- Devolve as 21 expressoes de politica a is_admin() com o texto de ANTES, apaga banners_admin_select_policy e
-- devolve banners_select_policy ao ramo "OU admin"; devolve os 10 corpos de funcao aos vigentes antes
-- (derivados das migrations que os definiram por ultimo: 20261002, 20261213, 20261222, 20261161, 20261122,
-- 20261177, 20261120 e a baseline 20260806), sem editar nada alem do gate.
-- Executar antes dos rollbacks da 97 . Sem BEGIN/COMMIT: transacao do aplicador.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261381000000$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_cmd text;
  v_roles text;
  v_perm boolean;
  v_caminho text;
BEGIN

  -- Portas da 97: corpo, seguranca, caminho e dono com BYPASSRLS; nenhuma leitura de cliente.
  FOR r IN SELECT * FROM (VALUES
    ('public.is_admin()', 'e4e624331673f15aaeb4a6703fef2d7c'),
    ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
    ('public.rls_admin_atual()', 'ccb7a56e835b8181795fffb7bee97305')
  ) AS porta(assinatura, hash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure(r.assinatura)
        AND md5(replace(p.prosrc, chr(13), '')) = r.hash
        AND p.prosecdef AND p.provolatile = 's'
        AND p.proconfig = CASE WHEN r.assinatura = 'public.is_admin()' THEN ARRAY['search_path=public, auth']::text[] ELSE ARRAY['search_path=public']::text[] END
        AND l.lanname = CASE WHEN r.assinatura = 'public.is_admin()' THEN 'plpgsql' ELSE 'sql' END) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: porta % ausente ou divergente.', r.assinatura;
    END IF;
  END LOOP;
  IF NOT COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
     OR has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.is_admin_atual()'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.is_admin_atual()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: EXECUTE das portas do admin atual divergente.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc a JOIN pg_proc b ON b.proowner = a.proowner JOIN pg_roles o ON o.oid = a.proowner
     WHERE a.oid = to_regprocedure('public.is_admin_atual()') AND b.oid = to_regprocedure('public.rls_admin_atual()')
       AND (o.rolsuper OR o.rolbypassrls OR (
         a.proowner = (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.profiles'))
         AND a.proowner = (SELECT relowner FROM pg_class WHERE oid = to_regclass('auth.users'))))
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: portas com donos diferentes ou sujeitos a RLS.';
  END IF;
  FOR r IN SELECT unnest(ARRAY['public._ninja_migrations','public.app_settings','public.assinatura_da_loja','public.banners','public.categorias','public.marketplace_ai_state','public.shipping_calculation_logs','public.shipping_quotes_cache','public.store_config','public.vor_receipts']) AS tabela LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(r.tabela)
      AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % precisa de RLS ligada e sem FORCE.', r.tabela;
    END IF;
  END LOOP;

  -- Politicas: a forma exata de pg_get_expr com search_path=pg_catalog (mesmo molde da 20261360).
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('public._ninja_migrations', 'Admins full access on _ninja_migrations', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.app_settings', 'Admins legacy access on app_settings', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.assinatura_da_loja', 'assinatura_da_loja_admin_select_policy', 'r', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.banners', 'banners_select_policy', 'r', 'public', '(((active = true) AND ((start_date IS NULL) OR (start_date <= now())) AND ((end_date IS NULL) OR (end_date >= now()))) OR ((( SELECT auth.role() AS role) = ''authenticated''::text) AND ( SELECT public.is_admin() AS is_admin)))', NULL::text, '((active = true) AND ((start_date IS NULL) OR (start_date <= now())) AND ((end_date IS NULL) OR (end_date >= now())))', NULL::text),
    ('public.banners', 'banners_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.banners', 'banners_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.banners', 'banners_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.categorias', 'categorias_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.categorias', 'categorias_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.categorias', 'categorias_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_select', 'r', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_insert', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_update', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_delete', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.shipping_calculation_logs', 'Admins have full access to shipping calculation logs', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.shipping_quotes_cache', 'Admins have full access to shipping_quotes_cache', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.store_config', 'store_config_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.store_config', 'store_config_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.store_config', 'store_config_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.vor_receipts', 'Admins can view all VOR receipts', 'r', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.vor_receipts', 'vor_receipts_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)')
  ) AS esperado(tabela, politica, comando, papeis, qual_antes, check_antes, qual_depois, check_depois) LOOP
    SELECT pg_get_expr(p.polqual,p.polrelid), pg_get_expr(p.polwithcheck,p.polrelid),
      p.polcmd::text,p.polpermissive,
      array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
        FROM unnest(p.polroles) x ORDER BY 1), ',')
      INTO v_qual,v_check,v_cmd,v_perm,v_roles FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela) AND p.polname = r.politica;
    IF NOT FOUND OR v_cmd IS DISTINCT FROM r.comando OR v_perm IS DISTINCT FROM true
       OR v_roles IS DISTINCT FROM r.papeis
       OR NOT (v_qual IS NOT DISTINCT FROM replace(r.qual_depois, chr(13), '') AND v_check IS NOT DISTINCT FROM replace(r.check_depois, chr(13), '')) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % em % ausente ou divergente (USING %, CHECK %).', r.politica,r.tabela,v_qual,v_check;
    END IF;
  END LOOP;
  -- A politica NOVA de leitura do administrador em banners (a vitrine anonima segue na banners_select_policy).
  SELECT pg_get_expr(p.polqual,p.polrelid), pg_get_expr(p.polwithcheck,p.polrelid),
    p.polcmd::text, p.polpermissive,
    array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
      FROM unnest(p.polroles) x ORDER BY 1), ',')
    INTO v_qual,v_check,v_cmd,v_perm,v_roles FROM pg_policy p
   WHERE p.polrelid = to_regclass('public.banners') AND p.polname = 'banners_admin_select_policy';
  IF FOUND THEN
    IF v_cmd IS DISTINCT FROM 'r' OR v_perm IS DISTINCT FROM true OR v_roles IS DISTINCT FROM 'authenticated'
       OR v_qual IS DISTINCT FROM '( SELECT public.rls_admin_atual() AS rls_admin_atual)' OR v_check IS NOT NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % em public.banners divergente (USING %, CHECK %).', 'banners_admin_select_policy',v_qual,v_check;
    END IF;
  ELSIF true THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % ausente em public.banners.', 'banners_admin_select_policy';
  END IF;
  PERFORM set_config('search_path',v_caminho,true);

  -- As dez RPCs: corpo, atributos, dono e ACL; uma assinatura so por nome.
  FOR r IN SELECT * FROM (VALUES
    ('public.get_admin_reviews_paged(text,text,integer,integer)', 'b596b887f11f422bb17366f51d3f5126', '8571a56a9b21e90ebdcf941d762870ac', 'plpgsql', 'v', ARRAY['search_path=public, extensions']::text[], 'jsonb', false),
    ('public.get_admin_questions_paged(text,text,integer,integer)', 'cf9a9f3d0ba69dcb07319155aaa42b4e', 'b81c0e320713adacfb5bf60ff1a8f100', 'plpgsql', 'v', ARRAY['search_path=public, extensions']::text[], 'jsonb', false),
    ('public.get_admin_products_paged(text,text,text,text,integer,integer)', 'd3a111d95dabb52efe7af6f3ce66fb7e', 'd204becede7d249e0a1871038f854a46', 'plpgsql', 'v', ARRAY['search_path=public, extensions']::text[], 'jsonb', false),
    ('public.get_reviews_metrics(text,integer)', 'cb41947ab5a8075cea87ab123913b10d', '71a40c86c6c1b23fbf991d653c746091', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)', true),
    ('public.buscar_por_codigo_barras(text)', '8762faab7f7efaf4bfd183499408d8df', 'e1b93114cd9deee7eda6801ef37ff1f9', 'plpgsql', 's', ARRAY['search_path=pg_catalog, pg_temp']::text[], 'jsonb', false),
    ('public.read_store_identity()', 'fde904462021d559c06a74247c004920', 'e4f75389e803ed6f4120cfdc1dd66138', 'plpgsql', 'v', ARRAY['search_path=pg_catalog, pg_temp']::text[], 'jsonb', false),
    ('public.assinatura_da_loja_ler()', '185a512ffd05dff0ad443600cf978d56', 'edeff71c925244a7a450c817d0acd6ae', 'plpgsql', 's', ARRAY['search_path=public']::text[], 'jsonb', false),
    ('public.record_vor_action(text,jsonb,jsonb,text)', '81ddb15ebf79c8ded8013017ac845d75', '13b0ca096e18e17d5276c8abc73994ec', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'void', false),
    ('public.reorder_banners_atomic(text,uuid,uuid)', '45bc4b902435bb2b0a1e55ab1cba10c1', '8530188cb2fd69a7d3bf24add96eb339', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'void', false),
    ('public.swap_banner_order(uuid,uuid)', '15c3314589ee962e7ce68579c2233d4e', '1f12fe589bf363bf828e8dfc4a06a529', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'void', false)
  ) AS esperado(assinatura, hash_antes, hash_depois, lang, volatil, config, resultado, conjunto) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
       WHERE p.oid=to_regprocedure(r.assinatura)
         AND md5(replace(p.prosrc, chr(13), '')) = r.hash_depois
         AND p.prokind='f' AND p.prosecdef AND l.lanname=r.lang AND p.provolatile=r.volatil
         AND p.proconfig=r.config AND pg_get_function_result(p.oid)=r.resultado AND p.proretset=r.conjunto
         AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.procost=100
         AND p.proowner=(SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.is_admin_atual()'))
         AND has_function_privilege('authenticated',p.oid,'EXECUTE')
         AND has_function_privilege('service_role',p.oid,'EXECUTE')
         AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
           WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RPC % ausente, corpo/atributos/dono/ACL divergentes.',r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
         AND proname=split_part(split_part(r.assinatura,'(',1),'.',2)) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: sobrecarga inesperada em %.', r.assinatura;
    END IF;
  END LOOP;
END $preflight_rollback_20261381000000$;

ALTER POLICY banners_select_policy ON public.banners
  USING ((((active = true) AND ((start_date IS NULL) OR (start_date <= now())) AND ((end_date IS NULL) OR (end_date >= now()))) OR ((( SELECT auth.role() AS role) = 'authenticated'::text) AND ( SELECT public.is_admin() AS is_admin))));

DROP POLICY IF EXISTS banners_admin_select_policy ON public.banners;

ALTER POLICY "Admins full access on _ninja_migrations" ON public._ninja_migrations
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "Admins legacy access on app_settings" ON public.app_settings
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY assinatura_da_loja_admin_select_policy ON public.assinatura_da_loja
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY banners_admin_insert_policy ON public.banners
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY banners_admin_update_policy ON public.banners
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY banners_admin_delete_policy ON public.banners
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY categorias_admin_insert_policy ON public.categorias
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY categorias_admin_update_policy ON public.categorias
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY categorias_admin_delete_policy ON public.categorias
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY marketplace_ai_state_admin_select ON public.marketplace_ai_state
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY marketplace_ai_state_admin_insert ON public.marketplace_ai_state
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY marketplace_ai_state_admin_update ON public.marketplace_ai_state
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY marketplace_ai_state_admin_delete ON public.marketplace_ai_state
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "Admins have full access to shipping calculation logs" ON public.shipping_calculation_logs
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "Admins have full access to shipping_quotes_cache" ON public.shipping_quotes_cache
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY store_config_admin_insert_policy ON public.store_config
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY store_config_admin_update_policy ON public.store_config
  USING (( SELECT public.is_admin() AS is_admin))
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

ALTER POLICY store_config_admin_delete_policy ON public.store_config
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY "Admins can view all VOR receipts" ON public.vor_receipts
  USING (( SELECT public.is_admin() AS is_admin));

ALTER POLICY vor_receipts_insert_policy ON public.vor_receipts
  WITH CHECK (( SELECT public.is_admin() AS is_admin));

CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(p_search text DEFAULT ''::text, p_rating text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
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
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    
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

CREATE OR REPLACE FUNCTION public.get_admin_questions_paged(p_search text DEFAULT ''::text, p_filter text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
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
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Compute total count with filters (before pagination)
    SELECT COUNT(q.id) INTO v_total_count
    FROM public.questions q
    LEFT JOIN public.profiles p ON p.id = q.user_id
    LEFT JOIN public.produtos prod ON prod.id = q.product_id
    WHERE (p_filter = 'all' OR NOT EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id))
      AND (
        v_clean_search = '' OR (
          unaccent(q.question) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            q.*,
            (
                SELECT jsonb_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url)
                FROM public.profiles p
                WHERE p.id = q.user_id
            ) AS "user",
            (
                SELECT jsonb_build_object('nome', prod.nome, 'imagem_url', prod.imagem_url)
                FROM public.produtos prod
                WHERE prod.id = q.product_id
            ) AS "product",
            (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at ASC),
                    '[]'::JSONB
                )
                FROM public.answers a
                WHERE a.question_id = q.id
            ) AS answers,
            EXISTS (
                SELECT 1 
                FROM public.marketplace_orders o
                JOIN public.marketplace_order_items oi ON oi.order_id = o.id
                WHERE o.user_id = q.user_id
                  AND o.status = 'delivered'
                  AND oi.product_id = q.product_id
            ) AS is_verified
        FROM public.questions q
        LEFT JOIN public.profiles p ON p.id = q.user_id
        LEFT JOIN public.produtos prod ON prod.id = q.product_id
        WHERE (p_filter = 'all' OR NOT EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id))
          AND (
            v_clean_search = '' OR (
              unaccent(q.question) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY q.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$function$;

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
    IF NOT public.is_admin() THEN
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
  IF NOT public.is_admin() THEN
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

CREATE OR REPLACE FUNCTION public.buscar_por_codigo_barras(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
    -- O codigo ja' normalizado: e' ele que vai na comparacao e no retorno,
    -- para a tela ecoar exatamente o que foi procurado.
    v_codigo text;
    -- 'variante', 'produto' ou NULL (nao achou). E' quem define `encontrado`.
    v_origem text := NULL;
    v_produto jsonb := NULL;
    v_variante jsonb := NULL;
    v_preco numeric := NULL;
    v_estoque integer := NULL;
    -- Lista vazia, NUNCA NULL: a tela faz `for` em cima dela sem perguntar.
    v_variacoes jsonb := '[]'::jsonb;
BEGIN
    -- GATE (D6). Primeira instrucao do corpo, antes de qualquer leitura:
    -- SECURITY DEFINER roda com o cracha' do dono, por cima da RLS, entao uma
    -- consulta antes daqui ja' e' catalogo vazando. `IS DISTINCT FROM true`
    -- porque `NOT NULL` e' NULL — com `NOT public.is_admin()` o portao ficaria
    -- aberto no caso mais estranho.
    IF public.is_admin() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja consulta código de barras.';
    END IF;

    -- NORMALIZACAO. `btrim` de DOIS argumentos, e nao o de um: `btrim(text)`
    -- sozinho apara APENAS espaco (' '), nunca \n, \r nem \t — medido no
    -- Postgres 16, `btrim(E'7891000000011\r\n')` devolve os 15 caracteres com
    -- o CRLF inteiro. E o leitor fisico se apresenta como TECLADO: termina o
    -- bipe com Enter (src/lib/leitor/buffer-do-leitor-fisico.ts), e EAN colado
    -- de planilha do fornecedor vem com CRLF. Com a forma de um argumento, o
    -- balcao diria "nao cadastrado" para produto que ESTA' cadastrado, e a
    -- entrada so'-branco escaparia do 22023 abaixo.
    v_codigo := NULLIF(btrim(p_codigo, E' \t\r\n'), '');
    IF v_codigo IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Informe o código de barras.';
    END IF;
    -- TETO: o leitor fisico se apresenta como TECLADO. Buffer estragado manda
    -- quilobytes, e sem este teto isso vira uma chave gigante comparada linha
    -- a linha. EAN-13 tem 13 digitos; GTIN-14, 14.
    IF length(v_codigo) > 64 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Código de barras inválido.';
    END IF;

    -- 1) A VARIACAO primeiro: o codigo de barras de verdade e' o da EMBALAGEM,
    -- e e' a caixa da combinacao ("Branca/PP") que o operador bipa. Como a
    -- unicidade do codigo e' POR TABELA (20261160000000), o mesmo codigo pode
    -- existir nas duas — a precedencia da variacao E' a regra desta RPC, e a
    -- pendencia que a C1.1 deixou registrada para ca'.
    -- `=` e nao `LIKE`: e' o que faz o indice unico parcial da C1.1 valer, e e'
    -- a unica leitura honesta de um codigo (um EAN pode ser prefixo de outro).
    SELECT
        jsonb_build_object(
            'id', p.id,
            'nome', p.nome,
            'ativo', p.ativo,
            'preco_venda', p.preco_venda,
            'estoque', p.estoque,
            'imagem', COALESCE(NULLIF(p.imagem_url, ''), p.imagem_urls[1]),
            'codigo_barras', p.codigo_barras,
            -- Achamos uma variacao ATIVA deste produto: o EXISTS seria
            -- verdadeiro por construcao, e uma consulta a mais nao compra
            -- verdade nenhuma.
            'tem_variantes', true
        ),
        jsonb_build_object(
            'id', v.id,
            'variant_id', v.id,
            'nome', v.name,
            'valor', v.value,
            'preco', COALESCE(v.price_override, p.preco_venda),
            'estoque', v.stock_increment,
            'imagem', COALESCE(NULLIF(v.image_url, ''), NULLIF(p.imagem_url, ''), p.imagem_urls[1]),
            'codigo_barras', v.codigo_barras
        ),
        -- A MESMA regra do checkout online (20261081000000:227) e do front
        -- (src/lib/preco-vendido.ts:19-24): so' cai no preco do produto quando
        -- o override e' NULL, porque ZERO e' preco legitimo (brinde).
        COALESCE(v.price_override, p.preco_venda),
        v.stock_increment
    INTO v_produto, v_variante, v_preco, v_estoque
    FROM public.product_variants v
    JOIN public.produtos p ON p.id = v.product_id
    WHERE v.codigo_barras = v_codigo
      AND v.active = true
      AND p.deleted_at IS NULL;

    IF FOUND THEN
        v_origem := 'variante';
    ELSE
        -- 2) O PRODUTO PAI. `deleted_at IS NULL` porque o delete de produto
        -- aqui e' SOFT: produto apagado e' INEXISTENTE. Mas `ativo = false`
        -- NAO filtra — produto inativo e' devolvido com "ativo": false, porque
        -- "inativo" e' um terceiro caso honesto, diferente de "nao cadastrado"
        -- e de "esgotado", e a tela precisa contar os tres de formas
        -- diferentes (cadastrar / reativar / repor).
        SELECT
            jsonb_build_object(
                'id', p.id,
                'nome', p.nome,
                'ativo', p.ativo,
                'preco_venda', p.preco_venda,
                'estoque', p.estoque,
                'imagem', COALESCE(NULLIF(p.imagem_url, ''), p.imagem_urls[1]),
                'codigo_barras', p.codigo_barras,
                -- MESMO predicado com que a v23 EXIGE variacao
                -- (20261081000000:276-281): se ele mentir, o balcao vende o
                -- produto base de um produto que so' existe em combinacao.
                'tem_variantes', EXISTS (
                    SELECT 1 FROM public.product_variants v2
                     WHERE v2.product_id = p.id AND v2.active = true
                )
            ),
            p.preco_venda,
            p.estoque,
            -- A folha de escolha da combinacao (§5.3, item 1): o operador bipou
            -- a etiqueta do MODELO e precisa dizer qual caixa esta' levando.
            -- `jsonb_agg` de conjunto vazio e' NULL, e NULL aqui obrigaria a
            -- tela a testar antes de iterar — dai' o COALESCE para '[]'.
            COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'variant_id', v2.id,
                        'nome', v2.name,
                        'valor', v2.value,
                        'preco', COALESCE(v2.price_override, p.preco_venda),
                        'estoque', v2.stock_increment,
                        'imagem', COALESCE(NULLIF(v2.image_url, ''), NULLIF(p.imagem_url, ''), p.imagem_urls[1]),
                        'codigo_barras', v2.codigo_barras
                    )
                    -- Ordem estavel: o operador escolhe por leitura, nao pela
                    -- sorte do planejador.
                    ORDER BY v2.name ASC, v2.value ASC
                )
                FROM public.product_variants v2
                WHERE v2.product_id = p.id AND v2.active = true
            ), '[]'::jsonb)
        INTO v_produto, v_preco, v_estoque, v_variacoes
        FROM public.produtos p
        WHERE p.codigo_barras = v_codigo
          AND p.deleted_at IS NULL;

        IF FOUND THEN
            v_origem := 'produto';
        ELSE
            -- `SELECT ... INTO` sem linha ZERA todas as variaveis de destino,
            -- inclusive `v_variacoes`. Repor a lista vazia aqui e' o que
            -- mantem o contrato: a chave existe sempre e nunca e' NULL.
            v_produto := NULL;
            v_preco := NULL;
            v_estoque := NULL;
            v_variacoes := '[]'::jsonb;
        END IF;
    END IF;

    -- UM retorno so', no fim: com dois caminhos de saida e' assim que uma das
    -- chaves some no caso raro. CODIGO NAO ENCONTRADO NAO E' ERRO — e' este
    -- mesmo objeto com `encontrado` falso, e a tela mostra o cartao "nao
    -- cadastrado" com o atalho de cadastro (§5.3).
    RETURN jsonb_build_object(
        'encontrado', v_origem IS NOT NULL,
        'origem', v_origem,
        'codigo', v_codigo,
        'produto', v_produto,
        'variante', v_variante,
        'preco', v_preco,
        'estoque', v_estoque,
        'variacoes', v_variacoes
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_store_identity()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE current_row public.store_config%ROWTYPE;
BEGIN
  IF public.is_admin() IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='IDENTITY_PERMISSION';
  END IF;
  SELECT * INTO current_row FROM public.store_config WHERE id=1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='IDENTITY_MISSING';
  END IF;
  RETURN jsonb_build_object('revision',current_row.identity_revision::text,'identity',
    jsonb_build_object('store_name',current_row.store_name,'store_city',current_row.store_city,
      'store_state',current_row.store_state,'primary_color',current_row.primary_color,
      'secondary_color',current_row.secondary_color,'accent_color',current_row.accent_color,
      'logo_url',current_row.logo_url,'branding_assets',current_row.branding_assets));
END;
$function$;

CREATE OR REPLACE FUNCTION public.assinatura_da_loja_ler()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT to_jsonb(a) - 'id' - 'observacao' FROM public.assinatura_da_loja a WHERE a.id = 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_vor_action(p_action_type text, p_input_data jsonb, p_output_data jsonb, p_proof_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_previous_hash TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Apenas o sistema ERP/Admin pode gravar recibos VOR diretamente.';
    END IF;

    -- Lock table to ensure sequentiality
    LOCK TABLE public.vor_receipts IN EXCLUSIVE MODE;

    SELECT proof_hash INTO v_previous_hash 
    FROM public.vor_receipts 
    ORDER BY created_at DESC 
    LIMIT 1;

    INSERT INTO public.vor_receipts (
        action_type, input_data, output_data, proof_hash, previous_hash
    ) VALUES (
        p_action_type, p_input_data, p_output_data, p_proof_hash, COALESCE(v_previous_hash, 'GENESIS_BLOCK_G19')
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_banners_atomic(p_position text, p_banner_id_1 uuid, p_banner_id_2 uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_banner record;
  v_next_order integer := 1;
  v_order_1 integer;
  v_order_2 integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  IF p_position NOT IN ('home_top', 'home_middle', 'home_bottom') THEN
    RAISE EXCEPTION 'Posição inválida.';
  END IF;

  PERFORM 1 FROM public.banners WHERE "position" = p_position FOR UPDATE;

  FOR v_banner IN
    SELECT id FROM public.banners
    WHERE "position" = p_position
    ORDER BY "order" ASC, id ASC
  LOOP
    UPDATE public.banners
    SET "order" = v_next_order
    WHERE id = v_banner.id AND "order" IS DISTINCT FROM v_next_order;

    v_next_order := v_next_order + 1;
  END LOOP;

  SELECT "order" INTO v_order_1 FROM public.banners
  WHERE id = p_banner_id_1 AND "position" = p_position;

  SELECT "order" INTO v_order_2 FROM public.banners
  WHERE id = p_banner_id_2 AND "position" = p_position;

  IF v_order_1 IS NULL OR v_order_2 IS NULL THEN
    RAISE EXCEPTION 'Banner não encontrado.';
  END IF;

  UPDATE public.banners
  SET "order" = v_order_2
  WHERE id = p_banner_id_1 AND "position" = p_position;

  UPDATE public.banners
  SET "order" = v_order_1
  WHERE id = p_banner_id_2 AND "position" = p_position;
END;
$function$;

CREATE OR REPLACE FUNCTION public.swap_banner_order(banner_id_1 uuid, banner_id_2 uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    order_1 INTEGER; order_2 INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;
    SELECT "order" INTO order_1 FROM public.banners WHERE id = banner_id_1;
    SELECT "order" INTO order_2 FROM public.banners WHERE id = banner_id_2;
    IF order_1 IS NULL OR order_2 IS NULL THEN RAISE EXCEPTION 'Banner não encontrado.'; END IF;
    UPDATE public.banners SET "order" = order_2 WHERE id = banner_id_1;
    UPDATE public.banners SET "order" = order_1 WHERE id = banner_id_2;
END;
$function$;

DO $conferencia_rollback_20261381000000$
DECLARE
  r record;
  v_qual text;
  v_check text;
  v_cmd text;
  v_roles text;
  v_perm boolean;
  v_caminho text;
BEGIN

  -- Portas da 97: corpo, seguranca, caminho e dono com BYPASSRLS; nenhuma leitura de cliente.
  FOR r IN SELECT * FROM (VALUES
    ('public.is_admin()', 'e4e624331673f15aaeb4a6703fef2d7c'),
    ('public.is_admin_atual()', '519842163e48cc377ac1337ffb9db936'),
    ('public.rls_admin_atual()', 'ccb7a56e835b8181795fffb7bee97305')
  ) AS porta(assinatura, hash) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
      WHERE p.oid = to_regprocedure(r.assinatura)
        AND md5(replace(p.prosrc, chr(13), '')) = r.hash
        AND p.prosecdef AND p.provolatile = 's'
        AND p.proconfig = CASE WHEN r.assinatura = 'public.is_admin()' THEN ARRAY['search_path=public, auth']::text[] ELSE ARRAY['search_path=public']::text[] END
        AND l.lanname = CASE WHEN r.assinatura = 'public.is_admin()' THEN 'plpgsql' ELSE 'sql' END) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: porta % ausente ou divergente.', r.assinatura;
    END IF;
  END LOOP;
  IF NOT COALESCE(has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE'), false)
     OR has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.is_admin_atual()'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.is_admin_atual()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: EXECUTE das portas do admin atual divergente.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc a JOIN pg_proc b ON b.proowner = a.proowner JOIN pg_roles o ON o.oid = a.proowner
     WHERE a.oid = to_regprocedure('public.is_admin_atual()') AND b.oid = to_regprocedure('public.rls_admin_atual()')
       AND (o.rolsuper OR o.rolbypassrls OR (
         a.proowner = (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.profiles'))
         AND a.proowner = (SELECT relowner FROM pg_class WHERE oid = to_regclass('auth.users'))))
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: portas com donos diferentes ou sujeitos a RLS.';
  END IF;
  FOR r IN SELECT unnest(ARRAY['public._ninja_migrations','public.app_settings','public.assinatura_da_loja','public.banners','public.categorias','public.marketplace_ai_state','public.shipping_calculation_logs','public.shipping_quotes_cache','public.store_config','public.vor_receipts']) AS tabela LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(r.tabela)
      AND relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % precisa de RLS ligada e sem FORCE.', r.tabela;
    END IF;
  END LOOP;

  -- Politicas: a forma exata de pg_get_expr com search_path=pg_catalog (mesmo molde da 20261360).
  v_caminho := current_setting('search_path');
  PERFORM set_config('search_path', 'pg_catalog', true);
  FOR r IN SELECT * FROM (VALUES
    ('public._ninja_migrations', 'Admins full access on _ninja_migrations', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.app_settings', 'Admins legacy access on app_settings', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.assinatura_da_loja', 'assinatura_da_loja_admin_select_policy', 'r', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.banners', 'banners_select_policy', 'r', 'public', '(((active = true) AND ((start_date IS NULL) OR (start_date <= now())) AND ((end_date IS NULL) OR (end_date >= now()))) OR ((( SELECT auth.role() AS role) = ''authenticated''::text) AND ( SELECT public.is_admin() AS is_admin)))', NULL::text, '((active = true) AND ((start_date IS NULL) OR (start_date <= now())) AND ((end_date IS NULL) OR (end_date >= now())))', NULL::text),
    ('public.banners', 'banners_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.banners', 'banners_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.banners', 'banners_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.categorias', 'categorias_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.categorias', 'categorias_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.categorias', 'categorias_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_select', 'r', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_insert', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_update', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_delete', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.shipping_calculation_logs', 'Admins have full access to shipping calculation logs', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.shipping_quotes_cache', 'Admins have full access to shipping_quotes_cache', '*', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.store_config', 'store_config_admin_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.store_config', 'store_config_admin_update_policy', 'w', 'authenticated', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.is_admin() AS is_admin)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)', '( SELECT public.rls_admin_atual() AS rls_admin_atual)'),
    ('public.store_config', 'store_config_admin_delete_policy', 'd', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.vor_receipts', 'Admins can view all VOR receipts', 'r', 'authenticated', '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)', NULL::text),
    ('public.vor_receipts', 'vor_receipts_insert_policy', 'a', 'authenticated', NULL::text, '( SELECT public.is_admin() AS is_admin)', NULL::text, '( SELECT public.rls_admin_atual() AS rls_admin_atual)')
  ) AS esperado(tabela, politica, comando, papeis, qual_antes, check_antes, qual_depois, check_depois) LOOP
    SELECT pg_get_expr(p.polqual,p.polrelid), pg_get_expr(p.polwithcheck,p.polrelid),
      p.polcmd::text,p.polpermissive,
      array_to_string(ARRAY(SELECT CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END
        FROM unnest(p.polroles) x ORDER BY 1), ',')
      INTO v_qual,v_check,v_cmd,v_perm,v_roles FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tabela) AND p.polname = r.politica;
    IF NOT FOUND OR v_cmd IS DISTINCT FROM r.comando OR v_perm IS DISTINCT FROM true
       OR v_roles IS DISTINCT FROM r.papeis
       OR NOT (v_qual IS NOT DISTINCT FROM replace(r.qual_antes, chr(13), '') AND v_check IS NOT DISTINCT FROM replace(r.check_antes, chr(13), '')) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % em % ausente ou divergente (USING %, CHECK %).', r.politica,r.tabela,v_qual,v_check;
    END IF;
  END LOOP;
  -- A politica NOVA de leitura do administrador em banners (a vitrine anonima segue na banners_select_policy).
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.banners') AND polname = 'banners_admin_select_policy') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: politica % ainda existe em public.banners.', 'banners_admin_select_policy';
  END IF;
  PERFORM set_config('search_path',v_caminho,true);

  -- As dez RPCs: corpo, atributos, dono e ACL; uma assinatura so por nome.
  FOR r IN SELECT * FROM (VALUES
    ('public.get_admin_reviews_paged(text,text,integer,integer)', 'b596b887f11f422bb17366f51d3f5126', '8571a56a9b21e90ebdcf941d762870ac', 'plpgsql', 'v', ARRAY['search_path=public, extensions']::text[], 'jsonb', false),
    ('public.get_admin_questions_paged(text,text,integer,integer)', 'cf9a9f3d0ba69dcb07319155aaa42b4e', 'b81c0e320713adacfb5bf60ff1a8f100', 'plpgsql', 'v', ARRAY['search_path=public, extensions']::text[], 'jsonb', false),
    ('public.get_admin_products_paged(text,text,text,text,integer,integer)', 'd3a111d95dabb52efe7af6f3ce66fb7e', 'd204becede7d249e0a1871038f854a46', 'plpgsql', 'v', ARRAY['search_path=public, extensions']::text[], 'jsonb', false),
    ('public.get_reviews_metrics(text,integer)', 'cb41947ab5a8075cea87ab123913b10d', '71a40c86c6c1b23fbf991d653c746091', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)', true),
    ('public.buscar_por_codigo_barras(text)', '8762faab7f7efaf4bfd183499408d8df', 'e1b93114cd9deee7eda6801ef37ff1f9', 'plpgsql', 's', ARRAY['search_path=pg_catalog, pg_temp']::text[], 'jsonb', false),
    ('public.read_store_identity()', 'fde904462021d559c06a74247c004920', 'e4f75389e803ed6f4120cfdc1dd66138', 'plpgsql', 'v', ARRAY['search_path=pg_catalog, pg_temp']::text[], 'jsonb', false),
    ('public.assinatura_da_loja_ler()', '185a512ffd05dff0ad443600cf978d56', 'edeff71c925244a7a450c817d0acd6ae', 'plpgsql', 's', ARRAY['search_path=public']::text[], 'jsonb', false),
    ('public.record_vor_action(text,jsonb,jsonb,text)', '81ddb15ebf79c8ded8013017ac845d75', '13b0ca096e18e17d5276c8abc73994ec', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'void', false),
    ('public.reorder_banners_atomic(text,uuid,uuid)', '45bc4b902435bb2b0a1e55ab1cba10c1', '8530188cb2fd69a7d3bf24add96eb339', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'void', false),
    ('public.swap_banner_order(uuid,uuid)', '15c3314589ee962e7ce68579c2233d4e', '1f12fe589bf363bf828e8dfc4a06a529', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'void', false)
  ) AS esperado(assinatura, hash_antes, hash_depois, lang, volatil, config, resultado, conjunto) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
       WHERE p.oid=to_regprocedure(r.assinatura)
         AND md5(replace(p.prosrc, chr(13), '')) = r.hash_antes
         AND p.prokind='f' AND p.prosecdef AND l.lanname=r.lang AND p.provolatile=r.volatil
         AND p.proconfig=r.config AND pg_get_function_result(p.oid)=r.resultado AND p.proretset=r.conjunto
         AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.procost=100
         AND p.proowner=(SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.is_admin_atual()'))
         AND has_function_privilege('authenticated',p.oid,'EXECUTE')
         AND has_function_privilege('service_role',p.oid,'EXECUTE')
         AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
         AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
           WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: RPC % ausente, corpo/atributos/dono/ACL divergentes.',r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
         AND proname=split_part(split_part(r.assinatura,'(',1),'.',2)) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: sobrecarga inesperada em %.', r.assinatura;
    END IF;
  END LOOP;
END $conferencia_rollback_20261381000000$;

NOTIFY pgrst, 'reload schema';
