-- 201b-antes-uma-avaliacao-por-cliente-e-a-media-so-das-publicadas-base-vigente: ANTES da 20261641000000. SO LEITURA, somente catalogo, rol fechado de
-- 6 linhas (o mesmo da 201a). A base vigente e' get_admin_reviews_paged com o corpo da 20261399996000 e get_reviews_metrics com o da 20261381000000, sem a
-- funcao nem o gatilho novos; aceita tambem o estado desta migration (reaplicacao idempotente, o que o pre-voo dela aceita). NAO le nenhuma avaliacao.
WITH gfn AS (
  SELECT md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
           AND l.lanname = 'plpgsql' AND p.prokind = 'f' AND p.provolatile = 'v' AND NOT p.proretset
           AND pg_get_function_result(p.oid) = 'trigger' AND p.pronargs = 0
           AND (SELECT count(*) FROM pg_catalog.pg_proc q
                WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'avaliacao_uma_por_cliente_e_produto') = 1
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AS atributos
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.avaliacao_uma_por_cliente_e_produto()')
), homonimas AS (
  SELECT count(*) AS n FROM pg_catalog.pg_proc q
   WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'avaliacao_uma_por_cliente_e_produto'
), rpc AS (
  SELECT p.proname::text AS nome, md5(replace(p.prosrc, chr(13), '')) AS h,
         p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND has_function_privilege('service_role', p.oid, 'EXECUTE')
           AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                            WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           AND (SELECT count(*) FROM pg_catalog.pg_proc q
                WHERE q.pronamespace = 'public'::regnamespace AND q.proname = p.proname) = 1 AS atributos
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
  WHERE p.oid IN (to_regprocedure('public.get_admin_reviews_paged(text,text,integer,integer,text)'),
                  to_regprocedure('public.get_reviews_metrics(text,integer)'))
), gat AS (
  SELECT count(*) AS n,
         COALESCE(bool_and(t.tgrelid = to_regclass('public.reviews')
           AND t.tgfoid = to_regprocedure('public.avaliacao_uma_por_cliente_e_produto()') AND t.tgtype = 7 AND t.tgenabled = 'O'
           AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgattr::text = ''), true) AS certo
  FROM pg_catalog.pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgname = 'tr_avaliacao_uma_por_cliente_e_produto'
), itens(item, esperado, vivo, ok) AS (
  SELECT 'avaliacao_uma_por_cliente_e_produto: corpo exato (md5)',
         'AUSENTE ou a84f4bc295a088c75ad926f43e16c39d',
         COALESCE(gfn.h, CASE WHEN homonimas.n > 0 THEN 'OUTRA ASSINATURA' ELSE 'AUSENTE' END),
         CASE WHEN gfn.h IS NULL THEN homonimas.n = 0 ELSE gfn.h = 'a84f4bc295a088c75ad926f43e16c39d' END
  FROM homonimas LEFT JOIN gfn ON true
  UNION ALL
  SELECT 'avaliacao_uma_por_cliente_e_produto: uma so, plpgsql SECURITY DEFINER VOLATILE, retorno trigger, search_path=public e EXECUTE de ninguem',
         'ausente ou sim',
         CASE WHEN gfn.h IS NULL THEN 'ausente' WHEN gfn.atributos THEN 'sim' ELSE 'nao' END,
         gfn.h IS NULL OR COALESCE(gfn.atributos, false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN gfn ON true
  UNION ALL
  SELECT 'tr_avaliacao_uma_por_cliente_e_produto: BEFORE INSERT por linha em reviews, chama a funcao, ligado, sem WHEN',
         'ausente ou sim',
         CASE WHEN gat.n = 0 THEN 'ausente' WHEN gat.n = 1 AND gat.certo THEN 'sim' ELSE 'nao' END,
         gat.n = 0 OR (gat.n = 1 AND gat.certo)
  FROM gat
  UNION ALL
  SELECT 'get_admin_reviews_paged: corpo exato (md5), metricas globais so das publicadas',
         '75f5c48de4eb4005a2516e54b3d33135 ou 21ba271d66edd776cab2443d32800db7',
         COALESCE((SELECT h FROM rpc WHERE nome = 'get_admin_reviews_paged'), 'AUSENTE'),
         COALESCE((SELECT h FROM rpc WHERE nome = 'get_admin_reviews_paged')
                  IN ('75f5c48de4eb4005a2516e54b3d33135', '21ba271d66edd776cab2443d32800db7'), false)
  UNION ALL
  SELECT 'get_reviews_metrics: corpo exato (md5), so as publicadas',
         '71a40c86c6c1b23fbf991d653c746091 ou 971268999fce410628356d65b99fbca5',
         COALESCE((SELECT h FROM rpc WHERE nome = 'get_reviews_metrics'), 'AUSENTE'),
         COALESCE((SELECT h FROM rpc WHERE nome = 'get_reviews_metrics')
                  IN ('71a40c86c6c1b23fbf991d653c746091', '971268999fce410628356d65b99fbca5'), false)
  UNION ALL
  SELECT 'get_admin_reviews_paged e get_reviews_metrics: uma assinatura cada, SECURITY DEFINER plpgsql VOLATILE, EXECUTE de authenticated e service_role (nem anon nem PUBLIC)', 'sim',
         CASE WHEN x.certo THEN 'sim' ELSE 'nao' END,
         x.certo
  FROM (SELECT count(*) = 2 AND COALESCE(bool_and(atributos), false) AS certo FROM rpc) AS x
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;
