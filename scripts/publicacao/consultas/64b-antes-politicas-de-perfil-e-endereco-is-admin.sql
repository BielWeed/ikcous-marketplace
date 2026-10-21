-- ANTES da 20261340000000 (ou depois do seu rollback): as mesmas 13 politicas com a porta is_admin() de antes.
-- SO LEITURA, somente catalogo, rol fechado de 4 linhas. Nenhuma linha de cliente e lida.
-- A expressao de cada politica e comparada SEM espacos e sem o prefixo public. (o search_path de quem consulta varia).
WITH alvo(tabela, politica, comando, qual, chk) AS (
  VALUES
    ('public.profiles', 'profiles_select_policy', 'r', '(((SELECTauth.uid()ASuid)=id)OR(SELECTis_admin()ASis_admin))', NULL::text),
    ('public.profiles', 'profiles_update_policy', 'w', '(((SELECTauth.uid()ASuid)=id)OR(SELECTis_admin()ASis_admin))', '(((SELECTauth.uid()ASuid)=id)OR(SELECTis_admin()ASis_admin))'),
    ('public.user_addresses', 'user_addresses_all_policy', '*', '(((SELECTauth.uid()ASuid)=user_id)OR(SELECTis_admin()ASis_admin))', '(((SELECTauth.uid()ASuid)=user_id)OR(SELECTis_admin()ASis_admin))'),
    ('public.push_subscriptions', 'push_subscriptions_all_policy', '*', '(((SELECTauth.uid()ASuid)=user_id)OR(SELECTis_admin()ASis_admin))', '(((SELECTauth.uid()ASuid)=user_id)OR(SELECTis_admin()ASis_admin))'),
    ('public.cart_items', 'cart_items_select_policy', 'r', '(((SELECTauth.uid()ASuid)=user_id)OR(SELECTis_admin()ASis_admin))', NULL::text),
    ('public.cart_items', 'cart_items_delete_policy', 'd', '(((SELECTauth.uid()ASuid)=user_id)OR(SELECTis_admin()ASis_admin))', NULL::text),
    ('public.notificacoes', 'notificacoes_select_policy', 'r', '(((SELECTauth.uid()ASuid)=usuario_id)OR(usuario_idISNULL)OR(SELECTis_admin()ASis_admin))', NULL::text),
    ('public.notificacoes', 'notificacoes_insert_policy', 'a', NULL::text, '(((SELECTauth.uid()ASuid)=usuario_id)OR(SELECTis_admin()ASis_admin))'),
    ('public.notificacoes', 'notificacoes_update_policy', 'w', '(((SELECTauth.uid()ASuid)=usuario_id)OR(SELECTis_admin()ASis_admin))', '(((SELECTauth.uid()ASuid)=usuario_id)OR(SELECTis_admin()ASis_admin))'),
    ('public.notificacoes', 'notificacoes_delete_policy', 'd', '(((SELECTauth.uid()ASuid)=usuario_id)OR(SELECTis_admin()ASis_admin))', NULL::text),
    ('public.push_notifications_log', 'push_notifications_log_admin_all_policy', '*', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)'),
    ('public.analytics_events', 'analytics_events_select_policy', 'r', '(SELECTis_admin()ASis_admin)', NULL::text),
    ('public.store_shipping_credentials', 'Admins have full access to shipping credentials', '*', '(SELECTis_admin()ASis_admin)', '(SELECTis_admin()ASis_admin)')
), politicas AS (
  SELECT a.politica,
         COALESCE(p.polcmd::text = a.comando
           AND p.polpermissive
           AND p.polroles = ARRAY['authenticated'::regrole::oid]
           AND regexp_replace(replace(pg_get_expr(p.polqual, p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') IS NOT DISTINCT FROM a.qual
           AND regexp_replace(replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') IS NOT DISTINCT FROM a.chk, false) AS ok
    FROM alvo a
    LEFT JOIN pg_policy p ON p.polrelid = to_regclass(a.tabela) AND p.polname = a.politica
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'perfil, endereco e notificacoes: 13 politicas com a porta is_admin de antes', 'sim',
    CASE WHEN (SELECT count(*) = 13 AND bool_and(ok) FROM politicas) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'portas do admin atual: corpos, dono e EXECUTE', 'sim',
    CASE WHEN EXISTS (
      SELECT 1
        FROM pg_proc a
        JOIN pg_proc b ON b.proowner = a.proowner
        JOIN pg_proc c ON c.oid = to_regprocedure('public.is_admin()')
        JOIN pg_roles o ON o.oid = a.proowner
       WHERE a.oid = to_regprocedure('public.is_admin_atual()')
         AND b.oid = to_regprocedure('public.rls_admin_atual()')
         AND md5(replace(c.prosrc, chr(13), '')) = 'e4e624331673f15aaeb4a6703fef2d7c'
         AND md5(replace(a.prosrc, chr(13), '')) = '519842163e48cc377ac1337ffb9db936'
         AND md5(replace(b.prosrc, chr(13), '')) = 'ccb7a56e835b8181795fffb7bee97305'
         AND a.prosecdef AND b.prosecdef
         AND (a.proowner = (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.profiles')) OR o.rolsuper OR o.rolbypassrls)
         AND has_function_privilege('authenticated', b.oid, 'EXECUTE')
         AND NOT has_function_privilege('authenticated', a.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', a.oid, 'EXECUTE')
    ) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'tabelas das 13 politicas: RLS ligada e sem FORCE', 'sim',
    CASE WHEN (SELECT count(*) = 8 AND bool_and(relkind = 'r' AND relrowsecurity AND NOT relforcerowsecurity)
                 FROM pg_class
                WHERE oid IN (to_regclass('public.profiles'), to_regclass('public.user_addresses'), to_regclass('public.push_subscriptions'), to_regclass('public.cart_items'), to_regclass('public.notificacoes'), to_regclass('public.push_notifications_log'), to_regclass('public.analytics_events'), to_regclass('public.store_shipping_credentials'))) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
