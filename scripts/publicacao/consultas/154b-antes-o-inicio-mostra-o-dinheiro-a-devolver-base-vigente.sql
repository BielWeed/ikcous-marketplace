-- 154b-antes-o-inicio-mostra-o-dinheiro-a-devolver-base-vigente: ANTES da 20261402000000 (o corpo vigente de painel_inicio: md5 8d58e15e7410afe0d254f37f38251df4, o da 20261399300000).
-- SO LEITURA, so catalogo; rol fechado de 5 linhas (controle; para painel_inicio, corpo exato (md5), atributos e ACL; e o fin_dre vivo, que o corpo novo le e tem de devolver lucro_liquido e
-- receita_liquida). Nao le pedido, devolucao, estorno nem lancamento e nao chama painel_inicio nem fin_dre. Comportamento provado por tests/banco/o-inicio-dinheiro-a-devolver-viva.cjs no CI.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
    COALESCE(p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proretset
     AND pg_get_function_arguments(p.oid) = ''
     AND pg_get_function_result(p.oid) = 'jsonb'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'painel_inicio') = 1, false) AS atributos,
    COALESCE(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                     WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE'), false) AS acl
  FROM (SELECT 1) um
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.painel_inicio()')
  LEFT JOIN pg_language l ON l.oid = p.prolang
), dre AS (
  SELECT COALESCE(position('''lucro_liquido''' IN p.prosrc) > 0 AND position('''receita_liquida''' IN p.prosrc) > 0, false) AS chaves
  FROM (SELECT 1) um
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.fin_dre(date,date)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'painel_inicio: corpo exato (md5)', '8d58e15e7410afe0d254f37f38251df4', COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'painel_inicio: assinatura e atributos conhecidos (plpgsql, SECURITY DEFINER, STABLE, search_path=public, uma so)', 'sim',
    CASE WHEN (SELECT atributos FROM fn) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'painel_inicio: EXECUTE authenticated e service_role, sem PUBLIC ou anon', 'sim',
    CASE WHEN (SELECT acl FROM fn) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_dre: devolve lucro_liquido e receita_liquida', 'sim',
    CASE WHEN (SELECT chaves FROM dre) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
