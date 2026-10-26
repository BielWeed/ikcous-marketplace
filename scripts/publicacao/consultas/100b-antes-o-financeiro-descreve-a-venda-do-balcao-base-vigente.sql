-- 100b-antes-o-financeiro-descreve-a-venda-do-balcao-base-vigente: ANTES da 20261391200000 (o da 20261177000000, md5 ec01f5e2eff4f132aaf075951484ea8a).
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhum pedido, lancamento nem cliente e nao chama a fin__movimentos.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prokind = 'f' AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'sql' AND p.provolatile = 's' AND p.proretset
     AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'fin__movimentos') = 1) AS atributos,
    (NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.fin__movimentos(date,date)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin__movimentos: corpo exato (md5)', 'ec01f5e2eff4f132aaf075951484ea8a',
    COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'fin__movimentos: assinatura e atributos conhecidos (sql, STABLE, SECURITY INVOKER, search_path=public, uma so)', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin__movimentos: sem EXECUTE para PUBLIC, anon ou authenticated', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
