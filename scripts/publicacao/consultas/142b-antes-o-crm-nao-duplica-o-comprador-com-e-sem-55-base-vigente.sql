-- 142b-antes-o-crm-nao-duplica-o-comprador-com-e-sem-55-base-vigente: ANTES da 20261399990000 (o da 20261178000000, md5 8a802f6324c86cdc0be214b4d5ac69bb).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhum pedido, perfil nem cliente e nao chama a crm__vendas.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'sql' AND p.provolatile = 's' AND p.proretset
     AND pg_get_function_arguments(p.oid) = 'p_ate timestamp with time zone'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'crm__vendas') = 1) AS atributos,
    (NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.crm__vendas(timestamptz)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'crm__vendas: corpo exato (md5)', '8a802f6324c86cdc0be214b4d5ac69bb',
    COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'crm__vendas: assinatura e atributos conhecidos (sql, STABLE, SECURITY INVOKER, search_path=public, uma so)', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'crm__vendas: sem EXECUTE para PUBLIC, anon ou authenticated', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
