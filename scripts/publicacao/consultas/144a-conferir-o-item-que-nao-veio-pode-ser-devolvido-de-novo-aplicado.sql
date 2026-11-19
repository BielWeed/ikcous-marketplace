-- 144a-conferir-o-item-que-nao-veio-pode-ser-devolvido-de-novo-aplicado: DEPOIS da 20261399992000 (os corpos desta migration: devolucao_elegibilidade bedd211bba45261dfbf962241ca3c9dd, solicitar_devolucao 52e5c30c06f9767a97e98f3a393b8496, devolucao_detalhe a439e320641d553e3a21883c6606c6f2).
-- SO LEITURA, somente catalogo; rol fechado de 5 linhas. Nao le nenhuma devolucao, pedido ou item e nao chama nenhuma das tres funcoes. Antes do apply responde 'nao' nas linhas dos corpos (a 144a negativa e' esperada), nunca erro.
WITH el AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 's' AND NOT p.proisstrict
     AND NOT p.proretset AND p.pronargs = 1 AND p.prorettype = 'jsonb'::regtype
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'devolucao_elegibilidade') = 1
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.devolucao_elegibilidade(uuid)')
), so AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 'v' AND NOT p.proisstrict
     AND NOT p.proretset AND p.pronargs = 7 AND p.prorettype = 'jsonb'::regtype
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'solicitar_devolucao') = 1
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])')
), de AS (
  SELECT p.oid, md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 's' AND NOT p.proisstrict
     AND NOT p.proretset AND p.pronargs = 1 AND p.prorettype = 'jsonb'::regtype
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'devolucao_detalhe') = 1
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS ok
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = to_regprocedure('public.devolucao_detalhe(uuid)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
         CASE WHEN COALESCE((SELECT count(*) > 0 FROM pg_proc WHERE pronamespace = 'public'::regnamespace), false) THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'devolucao_elegibilidade: corpo exato (md5)', 'bedd211bba45261dfbf962241ca3c9dd', COALESCE((SELECT h FROM el), 'AUSENTE')
  UNION ALL
  -- aceita os dois corpos EXATOS (o desta migration e o da sucessora 20261405400000); normaliza ao esperado historico do rol.
  SELECT 'solicitar_devolucao: corpo exato (md5)', '52e5c30c06f9767a97e98f3a393b8496',
         COALESCE((SELECT CASE WHEN h IN ('52e5c30c06f9767a97e98f3a393b8496', '94ecd75ba32dd0a8ce7d433f4b6f7961') THEN '52e5c30c06f9767a97e98f3a393b8496' ELSE h END FROM so), 'AUSENTE')
  UNION ALL
  -- aceita os dois corpos EXATOS (o desta migration e o da sucessora 20261404000000); normaliza ao esperado historico do rol.
  SELECT 'devolucao_detalhe: corpo exato (md5)', 'a439e320641d553e3a21883c6606c6f2',
         COALESCE((SELECT CASE WHEN h IN ('a439e320641d553e3a21883c6606c6f2', 'b4eb7a928f8a6ff04c34e93f4f56188c') THEN 'a439e320641d553e3a21883c6606c6f2' ELSE h END FROM de), 'AUSENTE')
  UNION ALL
  SELECT 'as tres: uma so de cada nome, atributos conhecidos (SECURITY DEFINER, plpgsql, volatilidade, retorno jsonb, search_path=public) e EXECUTE so do authenticated (nem PUBLIC nem anon)', 'sim',
         CASE WHEN COALESCE((SELECT ok FROM el), false) AND COALESCE((SELECT ok FROM so), false) AND COALESCE((SELECT ok FROM de), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
