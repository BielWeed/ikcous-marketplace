-- 156b-antes-a-observacao-da-inspecao-so-a-loja-ve-base-vigente: ANTES da 20261404000000 (devolucao_detalhe com o corpo vigente da 20261399992000, md5 a439e320641d553e3a21883c6606c6f2; authenticated ainda le a tabela inteira).
-- SO LEITURA, so catalogo; o MESMO rol fechado de 8 linhas da 156a (controle; devolucao_detalhe: corpo exato (md5), atributos e ACL; e, em public.devolucoes, a leitura da observacao por authenticated, a das outras
-- colunas, anon e PUBLIC sem leitura, service_role com a leitura inteira e a RLS ligada). Nao le nenhuma devolucao (nem a observacao de ninguem), nao chama devolucao_detalhe e nao muda privilegio. Comportamento
-- provado por tests/banco/a-observacao-da-inspecao-so-a-loja-ve-viva.cjs no CI.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
    COALESCE(p.prokind = 'f' AND p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 's' AND NOT p.proisstrict AND NOT p.proretset
     AND p.pronargs = 1 AND p.prorettype = 'jsonb'::regtype
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'devolucao_detalhe') = 1
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                     WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE'), false) AS ok
  FROM (SELECT 1) um
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.devolucao_detalhe(uuid)')
  LEFT JOIN pg_language l ON l.oid = p.prolang
), tb AS (
  SELECT c.oid AS oid, c.relrowsecurity AS rls FROM pg_class c WHERE c.oid = to_regclass('public.devolucoes')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucao_detalhe: corpo exato (md5)', 'a439e320641d553e3a21883c6606c6f2', COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao_detalhe: uma so, atributos conhecidos (plpgsql, SECURITY DEFINER, STABLE, search_path=public, retorno jsonb) e EXECUTE de authenticated, sem PUBLIC nem anon', 'sim',
    CASE WHEN (SELECT ok FROM fn) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucoes: authenticated le observacao_inspecao', 'sim',
    COALESCE((SELECT CASE WHEN has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT') THEN 'sim' ELSE 'nao' END
                FROM pg_attribute a
               WHERE a.attrelid = (SELECT oid FROM tb) AND a.attname = 'observacao_inspecao' AND a.attnum > 0 AND NOT a.attisdropped), 'AUSENTE')
  UNION ALL
  SELECT 'devolucoes: authenticated le as outras colunas (quantas)', '34',
    COALESCE((SELECT count(*)::text FROM pg_attribute a
               WHERE a.attrelid = (SELECT oid FROM tb) AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'observacao_inspecao'
                 AND has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')), 'AUSENTE')
  UNION ALL
  SELECT 'devolucoes: anon sem leitura e PUBLIC sem privilegio (tabela e coluna)', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM tb)
          AND NOT has_any_column_privilege('anon', (SELECT oid FROM tb), 'SELECT')
          AND NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
                           WHERE c.oid = (SELECT oid FROM tb) AND x.grantee = 0)
          AND NOT EXISTS (SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
                           WHERE a.attrelid = (SELECT oid FROM tb) AND a.attacl IS NOT NULL AND x.grantee = 0)
         THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucoes: service_role le a tabela e a observacao_inspecao', 'sim',
    CASE WHEN EXISTS (SELECT 1 FROM tb)
          AND has_table_privilege('service_role', (SELECT oid FROM tb), 'SELECT')
          AND COALESCE((SELECT has_column_privilege('service_role', a.attrelid, a.attname, 'SELECT') FROM pg_attribute a
                         WHERE a.attrelid = (SELECT oid FROM tb) AND a.attname = 'observacao_inspecao' AND NOT a.attisdropped), false)
         THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucoes: RLS ligada', 'sim',
    CASE WHEN COALESCE((SELECT rls FROM tb), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
