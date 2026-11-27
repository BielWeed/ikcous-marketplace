-- 201a-conferir-uma-avaliacao-por-cliente-e-a-media-so-das-publicadas-aplicado: DEPOIS da 20261641000000. SO LEITURA, somente catalogo, rol fechado de
-- 6 linhas. NAO le nenhuma avaliacao e NAO chama nenhuma funcao. Prova o corpo exato (md5) da funcao NOVA do gatilho e das duas RPCs do painel, os
-- atributos e a ACL da funcao do gatilho (EXECUTE de ninguem), o gatilho BEFORE INSERT ligado em reviews e as duas RPCs com a ACL de sempre
-- (authenticated e service_role, nem anon nem PUBLIC). Antes do apply (ou depois do rollback) as linhas de corpo respondem outro md5 ou AUSENTE
-- (a 201a negativa e' esperada), nunca erro.
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
  SELECT count(*) = 1 AND bool_and(t.tgrelid = to_regclass('public.reviews')
           AND t.tgfoid = to_regprocedure('public.avaliacao_uma_por_cliente_e_produto()') AND t.tgtype = 7 AND t.tgenabled = 'O'
           AND t.tgqual IS NULL AND t.tgnargs = 0 AND t.tgattr::text = '') AS certo
  FROM pg_catalog.pg_trigger t
  WHERE NOT t.tgisinternal AND t.tgname = 'tr_avaliacao_uma_por_cliente_e_produto'
), itens(item, esperado, vivo, ok) AS (
  SELECT 'avaliacao_uma_por_cliente_e_produto: corpo exato (md5)',
         'a84f4bc295a088c75ad926f43e16c39d',
         COALESCE(gfn.h, 'AUSENTE'),
         COALESCE(gfn.h = 'a84f4bc295a088c75ad926f43e16c39d', false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN gfn ON true
  UNION ALL
  SELECT 'avaliacao_uma_por_cliente_e_produto: uma so, plpgsql SECURITY DEFINER VOLATILE, retorno trigger, search_path=public e EXECUTE de ninguem', 'sim',
         CASE WHEN gfn.atributos THEN 'sim' ELSE 'nao' END,
         COALESCE(gfn.atributos, false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN gfn ON true
  UNION ALL
  SELECT 'tr_avaliacao_uma_por_cliente_e_produto: BEFORE INSERT por linha em reviews, chama a funcao, ligado, sem WHEN', 'sim',
         CASE WHEN gat.certo THEN 'sim' ELSE 'nao' END,
         COALESCE(gat.certo, false)
  FROM gat
  UNION ALL
  SELECT 'get_admin_reviews_paged: corpo exato (md5), metricas globais so das publicadas',
         '21ba271d66edd776cab2443d32800db7',
         COALESCE((SELECT h FROM rpc WHERE nome = 'get_admin_reviews_paged'), 'AUSENTE'),
         COALESCE((SELECT h FROM rpc WHERE nome = 'get_admin_reviews_paged') = '21ba271d66edd776cab2443d32800db7', false)
  UNION ALL
  SELECT 'get_reviews_metrics: corpo exato (md5), so as publicadas',
         '971268999fce410628356d65b99fbca5',
         COALESCE((SELECT h FROM rpc WHERE nome = 'get_reviews_metrics'), 'AUSENTE'),
         COALESCE((SELECT h FROM rpc WHERE nome = 'get_reviews_metrics') = '971268999fce410628356d65b99fbca5', false)
  UNION ALL
  SELECT 'get_admin_reviews_paged e get_reviews_metrics: uma assinatura cada, SECURITY DEFINER plpgsql VOLATILE, EXECUTE de authenticated e service_role (nem anon nem PUBLIC)', 'sim',
         CASE WHEN x.certo THEN 'sim' ELSE 'nao' END,
         x.certo
  FROM (SELECT count(*) = 2 AND COALESCE(bool_and(atributos), false) AS certo FROM rpc) AS x
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;
