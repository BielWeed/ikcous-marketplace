-- 157b-antes-a-devolucao-integral-nao-perde-o-centavo-do-cupom-base-vigente: ANTES da 20261405400000.
-- SO LEITURA, so catalogo: rol fechado de 3 linhas (controle, corpo exato e atributos/ACL).
-- Nao le pedidos ou devolucoes, nao chama solicitar_devolucao e nao muda privilegios.
WITH fn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
    (l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.prosecdef AND p.provolatile = 'v'
     AND NOT p.proisstrict AND NOT p.proretset AND p.pronargs = 7 AND p.prorettype = 'jsonb'::regtype
     AND p.proconfig = ARRAY['search_path=public']::text[]
     AND (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace
          AND q.proname = 'solicitar_devolucao') = 1
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS ok
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', 'sim',
    CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) > 0 THEN 'sim' ELSE 'nao' END
  UNION ALL
  SELECT 'solicitar_devolucao: corpo exato (md5)', '52e5c30c06f9767a97e98f3a393b8496', COALESCE((SELECT h FROM fn), 'AUSENTE')
  UNION ALL
  SELECT 'solicitar_devolucao: uma so, atributos conhecidos (plpgsql, SECURITY DEFINER, VOLATILE, search_path=public, retorno jsonb) e EXECUTE de authenticated, sem PUBLIC nem anon', 'sim',
    CASE WHEN COALESCE((SELECT ok FROM fn), false) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, vivo = esperado AS ok FROM itens ORDER BY ok, item;
