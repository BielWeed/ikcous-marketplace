-- 86b-antes-ex-admin-no-resto-do-painel-base-vigente: ANTES da 20261381000000 (estado vigente: 20261002, 20261213,
-- 20261222, 20261161, 20261122, 20261177, 20261120, baseline e as politicas com is_admin()).
-- SO LEITURA: um SELECT, somente catalogo. Rol fechado de 36 itens, mesma forma da 86a, com os valores de ANTES.
-- A politica banners_admin_select_policy ainda NAO existe (item positivo = ausente). Positiva antes do apply; depois do
-- rollback-manual volta a ser positiva. Rodar tambem a 8b-papeis-contraditorios ANTES do apply (quem perde acesso).
WITH alvo(tabela, politica, comando, papeis, qual, chk) AS (VALUES
    ('public._ninja_migrations', 'Admins full access on _ninja_migrations', '*', 'authenticated', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)'),
    ('public.app_settings', 'Admins legacy access on app_settings', '*', 'authenticated', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)'),
    ('public.assinatura_da_loja', 'assinatura_da_loja_admin_select_policy', 'r', 'authenticated', '(SELECTis_admin()ASis_admin)', NULL::text),
    ('public.banners', 'banners_select_policy', 'r', 'public', '(((active=true)AND((start_dateISNULL)OR(start_date<=now()))AND((end_dateISNULL)OR(end_date>=now())))OR(((SELECTauth.role()ASrole)=''authenticated''::text)AND(SELECTis_admin()ASis_admin)))', NULL::text),
    ('public.banners', 'banners_admin_insert_policy', 'a', 'authenticated', NULL::text, '(SELECTis_admin()ASis_admin)'),
    ('public.banners', 'banners_admin_update_policy', 'w', 'authenticated', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)'),
    ('public.banners', 'banners_admin_delete_policy', 'd', 'authenticated', '(SELECTis_admin()ASis_admin)', NULL::text),
    ('public.categorias', 'categorias_admin_insert_policy', 'a', 'authenticated', NULL::text, '(SELECTis_admin()ASis_admin)'),
    ('public.categorias', 'categorias_admin_update_policy', 'w', 'authenticated', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)'),
    ('public.categorias', 'categorias_admin_delete_policy', 'd', 'authenticated', '(SELECTis_admin()ASis_admin)', NULL::text),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_select', 'r', 'authenticated', '(SELECTis_admin()ASis_admin)', NULL::text),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_insert', 'a', 'authenticated', NULL::text, '(SELECTis_admin()ASis_admin)'),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_update', 'w', 'authenticated', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)'),
    ('public.marketplace_ai_state', 'marketplace_ai_state_admin_delete', 'd', 'authenticated', '(SELECTis_admin()ASis_admin)', NULL::text),
    ('public.shipping_calculation_logs', 'Admins have full access to shipping calculation logs', '*', 'authenticated', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)'),
    ('public.shipping_quotes_cache', 'Admins have full access to shipping_quotes_cache', '*', 'authenticated', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)'),
    ('public.store_config', 'store_config_admin_insert_policy', 'a', 'authenticated', NULL::text, '(SELECTis_admin()ASis_admin)'),
    ('public.store_config', 'store_config_admin_update_policy', 'w', 'authenticated', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)'),
    ('public.store_config', 'store_config_admin_delete_policy', 'd', 'authenticated', '(SELECTis_admin()ASis_admin)', NULL::text),
    ('public.vor_receipts', 'Admins can view all VOR receipts', 'r', 'authenticated', '(SELECTis_admin()ASis_admin)', NULL::text),
    ('public.vor_receipts', 'vor_receipts_insert_policy', 'a', 'authenticated', NULL::text, '(SELECTis_admin()ASis_admin)')
), funcoes(assinatura, hash, lang, volatil, config, resultado, conjunto) AS (VALUES
    ('public.get_admin_reviews_paged(text,text,integer,integer)', 'b596b887f11f422bb17366f51d3f5126', 'plpgsql', 'v', ARRAY['search_path=public, extensions']::text[], 'jsonb', false),
    ('public.get_admin_questions_paged(text,text,integer,integer)', 'cf9a9f3d0ba69dcb07319155aaa42b4e', 'plpgsql', 'v', ARRAY['search_path=public, extensions']::text[], 'jsonb', false),
    ('public.get_admin_products_paged(text,text,text,text,integer,integer)', 'd3a111d95dabb52efe7af6f3ce66fb7e', 'plpgsql', 'v', ARRAY['search_path=public, extensions']::text[], 'jsonb', false),
    ('public.get_reviews_metrics(text,integer)', 'cb41947ab5a8075cea87ab123913b10d', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'TABLE(average_rating numeric, total_verified bigint, total_replied bigint)', true),
    ('public.buscar_por_codigo_barras(text)', '8762faab7f7efaf4bfd183499408d8df', 'plpgsql', 's', ARRAY['search_path=pg_catalog, pg_temp']::text[], 'jsonb', false),
    ('public.read_store_identity()', 'fde904462021d559c06a74247c004920', 'plpgsql', 'v', ARRAY['search_path=pg_catalog, pg_temp']::text[], 'jsonb', false),
    ('public.assinatura_da_loja_ler()', '185a512ffd05dff0ad443600cf978d56', 'plpgsql', 's', ARRAY['search_path=public']::text[], 'jsonb', false),
    ('public.record_vor_action(text,jsonb,jsonb,text)', '81ddb15ebf79c8ded8013017ac845d75', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'void', false),
    ('public.reorder_banners_atomic(text,uuid,uuid)', '45bc4b902435bb2b0a1e55ab1cba10c1', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'void', false),
    ('public.swap_banner_order(uuid,uuid)', '15c3314589ee962e7ce68579c2233d4e', 'plpgsql', 'v', ARRAY['search_path=public']::text[], 'void', false)
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel','sim',
    CASE WHEN EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'portas do admin atual: corpos e seguranca','sim', CASE WHEN
    (SELECT count(*)=3 AND bool_and(md5(replace(p.prosrc,chr(13),''))=a.hash AND p.prosecdef
      AND p.provolatile='s' AND p.proconfig=CASE WHEN a.sig='public.is_admin()' THEN ARRAY['search_path=public, auth']::text[] ELSE ARRAY['search_path=public']::text[] END)
      FROM (VALUES ('public.is_admin()','e4e624331673f15aaeb4a6703fef2d7c'),
        ('public.is_admin_atual()','519842163e48cc377ac1337ffb9db936'),
        ('public.rls_admin_atual()','ccb7a56e835b8181795fffb7bee97305')) a(sig,hash)
      JOIN pg_proc p ON p.oid=to_regprocedure(a.sig))
    AND EXISTS(SELECT 1 FROM pg_proc a JOIN pg_proc b ON b.proowner=a.proowner JOIN pg_roles o ON o.oid=a.proowner
      WHERE a.oid=to_regprocedure('public.is_admin_atual()') AND b.oid=to_regprocedure('public.rls_admin_atual()')
        AND (o.rolsuper OR o.rolbypassrls OR (a.proowner=(SELECT relowner FROM pg_class WHERE oid=to_regclass('public.profiles'))
          AND a.proowner=(SELECT relowner FROM pg_class WHERE oid=to_regclass('auth.users'))))
        AND has_function_privilege('authenticated',b.oid,'EXECUTE')
        AND NOT has_function_privilege('anon',b.oid,'EXECUTE')
        AND NOT has_function_privilege('authenticated',a.oid,'EXECUTE')
        AND NOT has_function_privilege('anon',a.oid,'EXECUTE'))
    THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tabelas do lote: RLS ligada e sem FORCE','sim', CASE WHEN
    (SELECT count(*)=10 AND bool_and(c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity)
      FROM (VALUES ('public._ninja_migrations'),('public.app_settings'),('public.assinatura_da_loja'),('public.banners'),('public.categorias'),('public.marketplace_ai_state'),('public.shipping_calculation_logs'),('public.shipping_quotes_cache'),('public.store_config'),('public.vor_receipts')) a(tabela)
      JOIN pg_class c ON c.oid=to_regclass(a.tabela))
    THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'politica (antes): '||a.tabela||' / '||a.politica, 'sim', CASE WHEN
    p.polcmd::text=a.comando AND p.polpermissive
    AND p.polroles=CASE WHEN a.papeis='public' THEN ARRAY[0::oid] ELSE ARRAY['authenticated'::regrole::oid] END
    AND regexp_replace(replace(pg_get_expr(p.polqual,p.polrelid),'public.',''),'[[:space:]]','','g') IS NOT DISTINCT FROM a.qual
    AND regexp_replace(replace(pg_get_expr(p.polwithcheck,p.polrelid),'public.',''),'[[:space:]]','','g') IS NOT DISTINCT FROM a.chk
    THEN 'sim' ELSE 'nao' END
    FROM alvo a LEFT JOIN pg_policy p ON p.polrelid=to_regclass(a.tabela) AND p.polname=a.politica
  UNION ALL
  SELECT 'politica (antes): public.banners / banners_admin_select_policy ainda nao existe', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('public.banners') AND p.polname = 'banners_admin_select_policy')
    AND to_regclass('public.banners') IS NOT NULL THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'RPC: '||a.assinatura,'sim',CASE WHEN p.prosecdef AND l.lanname=a.lang AND p.prokind='f'
    AND p.provolatile=a.volatil AND p.proconfig=a.config AND pg_get_function_result(p.oid)=a.resultado AND p.proretset=a.conjunto
    AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u' AND p.procost=100
    AND p.proowner=(SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.is_admin_atual()'))
    AND md5(replace(p.prosrc,chr(13),''))=a.hash
    AND (SELECT count(*)=1 FROM pg_proc x WHERE x.pronamespace='public'::regnamespace AND x.proname=p.proname)
    AND has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE')
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) e WHERE e.grantee=0 AND e.privilege_type='EXECUTE')
    THEN 'sim' ELSE 'nao' END
    FROM funcoes a LEFT JOIN pg_proc p ON p.oid=to_regprocedure(a.assinatura) LEFT JOIN pg_language l ON l.oid=p.prolang
  UNION ALL
  SELECT 'varredura (antes): as 10 tabelas tem exatamente 21 politicas com is_admin()', 'sim', CASE WHEN
    (SELECT count(*) FROM pg_policy p WHERE p.polrelid = ANY (ARRAY[to_regclass('public._ninja_migrations'), to_regclass('public.app_settings'), to_regclass('public.assinatura_da_loja'), to_regclass('public.banners'), to_regclass('public.categorias'), to_regclass('public.marketplace_ai_state'), to_regclass('public.shipping_calculation_logs'), to_regclass('public.shipping_quotes_cache'), to_regclass('public.store_config'), to_regclass('public.vor_receipts')]::regclass[])
       AND coalesce(pg_get_expr(p.polqual,p.polrelid),'') || coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') ~ 'is_admin[[:space:]]*\(') = 21
    THEN 'sim' ELSE 'nao' END
)
SELECT item,esperado,vivo,COALESCE(vivo=esperado,false) AS ok FROM itens ORDER BY ok,item;
