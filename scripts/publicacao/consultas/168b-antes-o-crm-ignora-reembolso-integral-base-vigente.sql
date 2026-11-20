-- ANTES da 20261412000000. Corpo vigente desde 20261399990000.
-- So leitura do catalogo: nao chama a funcao nem le pedidos ou devolucoes.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'sql' AND p.provolatile = 's' AND p.proretset AND NOT p.proisstrict
     AND pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'
     AND pg_get_function_result(p.oid) = 'TABLE(order_id uuid, total numeric, canal text, forma text, pago_em timestamp with time zone, dia date, chave text, user_id uuid, nome text, whatsapp text, email text)'
     AND (SELECT count(*) FROM pg_catalog.pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'crm__vendas') = 1) AS atributos,
    (NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.crm__vendas(timestamptz)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace)
         THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'crm__vendas: corpo exato (md5)', 'bd683b55c36dff83eefa0282077d9a63', COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'crm__vendas: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'crm__vendas: sem EXECUTE para PUBLIC, anon ou authenticated', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
