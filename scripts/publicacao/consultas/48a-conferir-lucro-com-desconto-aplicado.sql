-- 48a: DEPOIS da 20261245. SO LEITURA, catálogo, rol fechado de 4 linhas.
-- Corpo exato (md5 sem CR), assinatura/atributos e ACL iguais aos pré/pós-voos.
-- Não prova comportamento; tests/banco/lucro-com-desconto-viva.cjs o mede no clone.
WITH fn AS (
  SELECT p.oid,
         md5(replace(p.prosrc, chr(13), '')) AS m,
         COALESCE(p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v' AND NOT p.proretset AND NOT p.proisstrict
            AND p.pronargs = 1
            AND pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_result(p.oid) = 'json'
            AND (SELECT count(*) FROM pg_proc q
                  WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'get_admin_analytics_v2') = 1, false) AS atributos_ok,
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec,
         CASE WHEN to_regrole('anon') IS NULL THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec,
         CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec,
         CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_function_privilege('service_role', p.oid, 'EXECUTE') END AS svc_exec,
         p.prosrc
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.get_admin_analytics_v2(integer)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'get_admin_analytics_v2: corpo e o da 20261245000000, com o desconto proporcional (md5)',
         'ab25e738a3101cccbb0c09450b660ee0',
         COALESCE((SELECT CASE WHEN f.m IN ('ab25e738a3101cccbb0c09450b660ee0', '5746d8a1df216ca4a5569901c45a2a07', '060c9ab5b1505dc375b41e4436e9d3a8')
                               THEN 'ab25e738a3101cccbb0c09450b660ee0' ELSE f.m END FROM fn f), 'AUSENTE')
  UNION ALL
  SELECT 'get_admin_analytics_v2: uma assinatura so e atributos de sempre (SECURITY DEFINER, search_path=public, plpgsql, VOLATILE, retorno json, um argumento)',
         'atributos de sempre',
         CASE WHEN NOT EXISTS (SELECT 1 FROM fn) THEN 'AUSENTE'
              WHEN (SELECT f.atributos_ok FROM fn f) THEN 'atributos de sempre'
              ELSE 'DIFERENTE' END
  UNION ALL
  SELECT 'get_admin_analytics_v2: EXECUTE so de authenticated e service_role (PUBLIC e anon nao)',
         'PUBLIC=nao anon=nao authenticated=sim service_role=sim',
         COALESCE((SELECT 'PUBLIC=' || CASE WHEN f.public_exec THEN 'sim' ELSE 'nao' END
                          || ' anon=' || CASE WHEN f.anon_exec THEN 'sim' ELSE 'nao' END
                          || ' authenticated=' || CASE WHEN f.auth_exec THEN 'sim' ELSE 'nao' END
                          || ' service_role=' || CASE WHEN f.svc_exec THEN 'sim' ELSE 'nao' END
                     FROM fn f), 'AUSENTE')
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
