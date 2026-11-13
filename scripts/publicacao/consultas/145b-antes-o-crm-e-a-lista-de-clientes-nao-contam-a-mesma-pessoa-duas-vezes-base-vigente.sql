-- 145b-antes-o-crm-e-a-lista-de-clientes-nao-contam-a-mesma-pessoa-duas-vezes-base-vigente: ANTES da 20261399993000 (a base vigente: crm__nunca_comprou da 20261183000000, 9a83cf34789b8b67c245648c8d82fc42, e get_admin_customers_paged da 20261392000000, 1c71829d75e3d8f17bf7fb01019c05ec).
-- SO LEITURA, somente catalogo; rol fechado de 5 linhas. Nao le nenhum perfil, endereco, pedido ou cliente e nao chama nenhuma das duas funcoes.
-- Antes do apply a 145a responde 'nao' nas linhas dos corpos (a 145a negativa e' esperada), nunca erro; a 145b e' a conferencia da base vigente.
WITH nu AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'sql' AND p.prokind = 'f' AND NOT p.prosecdef AND p.provolatile = 's' AND NOT p.proisstrict
     AND p.proretset AND p.pronargs = 1
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'crm__nunca_comprou') = 1
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.crm__nunca_comprou(timestamptz)')
), cl AS (
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
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'crm__nunca_comprou: corpo exato (md5)', '9a83cf34789b8b67c245648c8d82fc42', COALESCE((SELECT h FROM nu), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_customers_paged: corpo exato (md5)', '1c71829d75e3d8f17bf7fb01019c05ec', COALESCE((SELECT h FROM cl), 'AUSENTE')
  UNION ALL
  SELECT 'crm__nunca_comprou: uma so, atributos conhecidos (sql, STABLE, SECURITY INVOKER, search_path=public) e sem EXECUTE para PUBLIC, anon ou authenticated', 'sim',
         CASE WHEN COALESCE((SELECT ok FROM nu), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'get_admin_customers_paged: uma so, atributos conhecidos (plpgsql, SECURITY DEFINER, VOLATILE, search_path=public, extensions) e EXECUTE so de authenticated e service_role (nem PUBLIC nem anon)', 'sim',
         CASE WHEN COALESCE((SELECT ok FROM cl), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
