-- 155a-conferir-o-total-comprado-do-cliente-e-o-mesmo-no-crm-na-lista-e-na-ficha-aplicado: DEPOIS da 20261403000000 (os corpos desta migration: get_admin_customers_paged 309bbd903420f146423c7cf0512b91b3, get_admin_user_detail e7977d4d60b6114bb8247097b8ae3d4b).
-- SO LEITURA, somente catalogo; rol fechado de 5 linhas. Nao le nenhum perfil, endereco, pedido ou cliente e nao chama nenhuma das duas funcoes.
-- Antes do apply a 155a responde 'nao' nas linhas dos corpos (a 155a negativa e' esperada), nunca erro; a 155b e' a conferencia da base vigente.
WITH cl AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict
     AND NOT p.proretset AND p.pronargs = 5 AND p.prorettype = 'jsonb'::regtype
     AND p.proconfig = ARRAY['search_path=public, extensions']::text[]
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_customers_paged') = 1
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.get_admin_customers_paged(text,text,text,integer,integer)')
), fi AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict
     AND NOT p.proretset AND p.pronargs = 1 AND p.prorettype = 'jsonb'::regtype
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_user_detail') = 1
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.get_admin_user_detail(uuid)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_customers_paged: corpo exato (md5)', '309bbd903420f146423c7cf0512b91b3', COALESCE((SELECT h FROM cl), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_user_detail: corpo exato (md5)', 'e7977d4d60b6114bb8247097b8ae3d4b', COALESCE((SELECT h FROM fi), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_customers_paged: uma so, atributos conhecidos (plpgsql, SECURITY DEFINER, VOLATILE, search_path=public, extensions) e EXECUTE so de authenticated e service_role (nem PUBLIC nem anon)', 'sim',
         CASE WHEN COALESCE((SELECT ok FROM cl), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_user_detail: uma so, atributos conhecidos (plpgsql, SECURITY DEFINER, VOLATILE, search_path=public) e EXECUTE so de authenticated e service_role (nem PUBLIC nem anon)', 'sim',
         CASE WHEN COALESCE((SELECT ok FROM fi), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
