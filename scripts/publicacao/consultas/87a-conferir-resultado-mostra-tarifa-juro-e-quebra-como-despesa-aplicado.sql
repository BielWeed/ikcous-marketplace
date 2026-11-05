-- 87a-conferir-resultado-mostra-tarifa-juro-e-quebra-como-despesa-aplicado: DEPOIS da 20261382000000.
-- SO LEITURA, so catalogo; rol fechado de 4 linhas. Nao le nenhuma linha financeira nem chama a fin_dre.
WITH fn AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
     AND l.lanname = 'plpgsql' AND p.provolatile = 's'
     AND NOT p.proisstrict AND NOT p.proretset AND p.prorettype = 'jsonb'::regtype
     AND pg_get_function_arguments(p.oid) = 'p_inicio date, p_fim date'
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'fin_dre') = 1) AS atributos,
    (has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS acl
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.fin_dre(date,date)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_dre: corpo exato (md5)', '2d191bc8120a9b188c04eeaaa0263110',
    -- A 20261399600000 (o resultado credita o custo da devolucao de outro mes) sucede so o fin_dre: aceita os dois corpos
    -- EXATOS (o desta e o dela); normaliza ao esperado historico do rol.
    COALESCE((SELECT CASE WHEN h IN ('2d191bc8120a9b188c04eeaaa0263110', 'eafc6a2c4663e33f5459791c6601b848')
                         THEN '2d191bc8120a9b188c04eeaaa0263110' ELSE h END FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'fin_dre: assinatura e atributos conhecidos', 'sim',
    CASE WHEN COALESCE((SELECT atributos FROM fn), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'fin_dre: EXECUTE authenticated, sem PUBLIC ou anon', 'sim',
    CASE WHEN COALESCE((SELECT acl FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
