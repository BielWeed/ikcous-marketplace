-- 202a-conferir-a-peca-que-volta-sem-tamanho-aplicado: DEPOIS da 20261642000000 (devolver_estoque e admin_devolucao_concluir com o ramo da peca sem
-- tamanho, a tabela public.pecas_sem_tamanho e as RPCs pecas_sem_tamanho_pendentes(uuid) e resolver_peca_sem_tamanho(uuid, uuid)). SO LEITURA, somente
-- catalogo; rol fechado de 6 linhas. NAO le nenhuma linha de pedido, devolucao, produto nem peca e NAO chama funcao nenhuma. Antes do apply (ou depois do
-- rollback) as linhas da migration respondem 'AUSENTE' ou 'nao' (a 202a negativa e' esperada), nunca erro.
WITH fn AS (
  SELECT p.proname::text AS nome, md5(replace(p.prosrc, chr(13), '')) AS h, p.oid
    FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('devolver_estoque', 'admin_devolucao_concluir', 'pecas_sem_tamanho_pendentes', 'resolver_peca_sem_tamanho')
), novas AS (
  SELECT count(*) = 2
         AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]
              AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
              AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
              AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
              AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS certas
    FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('pecas_sem_tamanho_pendentes', 'resolver_peca_sem_tamanho')
), tab AS (
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.pecas_sem_tamanho') AND c.relkind = 'r' AND c.relrowsecurity)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.pecas_sem_tamanho'))
         AND COALESCE((SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
                         FROM pg_catalog.pg_attribute a
                        WHERE a.attrelid = to_regclass('public.pecas_sem_tamanho') AND a.attnum > 0 AND NOT a.attisdropped)
                       = 'criada_em:timestamp with time zone:true,devolucao_item_id:uuid:false,id:uuid:true,order_id:uuid:false,order_item_id:uuid:false,origem:text:true,produto_id:uuid:true,resolucao:text:false,resolvida_em:timestamp with time zone:false,resolvida_por:uuid:false,variant_id:uuid:false', false)
         AND NOT has_table_privilege('anon', to_regclass('public.pecas_sem_tamanho'), 'SELECT,INSERT,UPDATE,DELETE')
         AND NOT has_table_privilege('authenticated', to_regclass('public.pecas_sem_tamanho'), 'SELECT,INSERT,UPDATE,DELETE')
         AND NOT has_table_privilege('service_role', to_regclass('public.pecas_sem_tamanho'), 'SELECT,INSERT,UPDATE,DELETE') AS certa
   WHERE to_regclass('public.pecas_sem_tamanho') IS NOT NULL
), itens(item, esperado, vivo, ok) AS (
  SELECT 'devolver_estoque: corpo exato (md5)', '80b1a90baf10d1b4c59484772e4864c4',
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque'), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque') = '80b1a90baf10d1b4c59484772e4864c4', false)
  UNION ALL
  SELECT 'admin_devolucao_concluir: corpo exato (md5)', '1a548896acb8248f1b1771d765c92fcb',
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir'), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir') = '1a548896acb8248f1b1771d765c92fcb', false)
  UNION ALL
  SELECT 'pecas_sem_tamanho_pendentes: corpo exato (md5)', 'd6a9047fe26305d0c1446c284033245d',
         COALESCE((SELECT h FROM fn WHERE nome = 'pecas_sem_tamanho_pendentes'), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'pecas_sem_tamanho_pendentes') = 'd6a9047fe26305d0c1446c284033245d', false)
  UNION ALL
  SELECT 'resolver_peca_sem_tamanho: corpo exato (md5)', 'cac3d04d9be77c7d4004003bb70561c5',
         COALESCE((SELECT h FROM fn WHERE nome = 'resolver_peca_sem_tamanho'), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'resolver_peca_sem_tamanho') = 'cac3d04d9be77c7d4004003bb70561c5', false)
  UNION ALL
  SELECT 'as duas RPCs novas: uma so cada, SECURITY DEFINER, search_path=public e EXECUTE so do authenticated (nem PUBLIC, anon ou service_role)', 'sim',
         CASE WHEN novas.certas THEN 'sim' ELSE 'nao' END,
         COALESCE(novas.certas, false)
  FROM novas
  UNION ALL
  SELECT 'pecas_sem_tamanho: a tabela da 20261642000000 (11 colunas), RLS ligada, sem politica e sem privilegio de aplicacao', 'sim',
         CASE WHEN tab.certa THEN 'sim' ELSE 'nao' END,
         COALESCE(tab.certa, false)
  FROM (VALUES (1)) AS controle(n) LEFT JOIN tab ON true
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;
