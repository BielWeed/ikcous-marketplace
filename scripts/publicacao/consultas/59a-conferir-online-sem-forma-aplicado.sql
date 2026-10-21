-- 59a-conferir-online-sem-forma-aplicado: DEPOIS da 20261290000000; SO LEITURA, catalogo, rol fechado de 4 linhas.
-- Exige o corpo EXATO da 290 em fin__forma_do_pedido (online sem metodo vira online_desconhecido),
-- com assinatura, atributos e ACL que a 290 preserva. Nao ler pedido nem dado de cliente.
-- Hash = md5(replace(prosrc, chr(13), '')); desconhecido ou ausente recusa.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS m,
         COALESCE(NOT p.prosecdef AND l.lanname = 'sql' AND p.provolatile = 'i'
           AND NOT p.proretset AND NOT p.proisstrict
           AND p.pronargs = 2 AND p.pronargdefaults = 0
           AND p.proconfig = ARRAY['search_path=public']::text[]
           AND pg_get_function_result(p.oid) = 'text'
           AND (SELECT count(*) FROM pg_proc q
                 WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'fin__forma_do_pedido') = 1, false) AS atributos_ok,
         NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND CASE WHEN to_regrole('anon') IS NULL THEN false ELSE NOT has_function_privilege('anon', p.oid, 'EXECUTE') END
           AND CASE WHEN to_regrole('authenticated') IS NULL THEN false ELSE NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS acl_ok
    FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.fin__forma_do_pedido(text,text)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim', CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin__forma_do_pedido: corpo da 20261290000000 (online sem forma, md5)', 'c147541bc85f640161025e4c9ca8c8c3',
         COALESCE((SELECT m FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'fin__forma_do_pedido: assinatura e atributos (sql, IMMUTABLE, search_path=public, sem SECURITY DEFINER nem sobrecarga)', 'sim',
         CASE WHEN COALESCE((SELECT count(*) = 1 AND bool_and(atributos_ok) FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin__forma_do_pedido: sem EXECUTE para PUBLIC, anon e authenticated', 'sim',
         CASE WHEN COALESCE((SELECT count(*) = 1 AND bool_and(acl_ok) FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
