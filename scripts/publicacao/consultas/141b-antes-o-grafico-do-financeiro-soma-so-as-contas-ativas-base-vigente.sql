-- 141b-antes-o-grafico-do-financeiro-soma-so-as-contas-ativas-base-vigente: ANTES da 20261399985000 (o corpo vigente de fin_resumo: md5 a10e7f301eaf6b3edfac50bc87ff74bc, o da 20261399300000).
-- SO LEITURA, so catalogo; rol fechado de 5 linhas (controle e, para fin_resumo, corpo exato (md5), atributos e ACL, mais o corpo exato de fin__saldos, cuja conta o corpo novo repete). Nao le conta, lancamento, pedido
-- nem cliente e nao chama fin_resumo nem fin__saldos. Comportamento (o saldo ao fim de cada dia bate com o saldo_total, controle com o corpo anterior, mutantes) provado por
-- tests/banco/o-grafico-do-financeiro-soma-so-as-contas-ativas-viva.cjs no CI.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
    COALESCE(p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proretset
     AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
     AND pg_get_function_result(p.oid) = 'jsonb'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'fin_resumo') = 1, false) AS atributos,
    COALESCE(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                     WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE'), false) AS acl
  FROM (SELECT 1) um
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.fin_resumo(date,date)')
  LEFT JOIN pg_language l ON l.oid = p.prolang
), saldos AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h
  FROM (SELECT 1) um
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.fin__saldos()')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_resumo: corpo exato (md5)', 'a10e7f301eaf6b3edfac50bc87ff74bc', COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'fin_resumo: assinatura e atributos conhecidos (plpgsql, SECURITY DEFINER, STABLE, search_path=public, uma so)', 'sim',
    CASE WHEN (SELECT atributos FROM fn) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_resumo: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN (SELECT acl FROM fn) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin__saldos: corpo exato (md5)', '5992ecf164d886110c21dbf93a5c607e', COALESCE((SELECT h FROM saldos), 'AUSENTE')
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
