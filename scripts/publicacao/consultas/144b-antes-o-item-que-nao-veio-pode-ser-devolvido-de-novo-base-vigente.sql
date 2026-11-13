-- 144b-antes-o-item-que-nao-veio-pode-ser-devolvido-de-novo-base-vigente: ANTES da 20261399992000 (ou depois do rollback-manual dela): os corpos vigentes da 20261199000000 (elegibilidade 0bdb635f4f04e8edb894b70da58282e7, detalhe 6897a45df3e5d29256f85611ea3ca91f) e da 20261175000000 (solicitar_devolucao a12d11acdcc07992f4a5f527106a1cf8).
-- SO LEITURA, somente catalogo; rol fechado de 5 linhas. Nao le nenhuma devolucao, pedido ou item e nao chama nenhuma das tres funcoes. Antes do apply tudo 'sim'; depois do apply as linhas dos corpos ficam 'nao' de proposito.
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
  SELECT 'devolucao_elegibilidade: corpo exato (md5)', '0bdb635f4f04e8edb894b70da58282e7', COALESCE((SELECT h FROM el), 'AUSENTE')
  UNION ALL
  SELECT 'solicitar_devolucao: corpo exato (md5)', 'a12d11acdcc07992f4a5f527106a1cf8', COALESCE((SELECT h FROM so), 'AUSENTE')
  UNION ALL
  SELECT 'devolucao_detalhe: corpo exato (md5)', '6897a45df3e5d29256f85611ea3ca91f', COALESCE((SELECT h FROM de), 'AUSENTE')
  UNION ALL
  SELECT 'as tres: uma so de cada nome, atributos conhecidos (SECURITY DEFINER, plpgsql, volatilidade, retorno jsonb, search_path=public) e EXECUTE so do authenticated (nem PUBLIC nem anon)', 'sim',
         CASE WHEN COALESCE((SELECT ok FROM el), false) AND COALESCE((SELECT ok FROM so), false) AND COALESCE((SELECT ok FROM de), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
