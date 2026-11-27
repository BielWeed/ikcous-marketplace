-- 201b-antes-a-peca-que-volta-sem-tamanho-base-vigente: ANTES da 20261642000000. SO LEITURA, somente catalogo, rol fechado de 4 linhas. NAO le nenhuma
-- linha de pedido, devolucao, produto nem peca e NAO chama funcao nenhuma. A base vigente e' o corpo da 20261389100000 (devolver_estoque) e o da
-- 20261395200000 (admin_devolucao_concluir); aceita tambem os corpos desta para uma reaplicacao idempotente. A tabela pecas_sem_tamanho pode faltar (loja
-- que nunca recebeu a migration) ou ja ter a forma desta (o rollback a mantem); outra forma faz o pre-voo recusar, e esta linha responde 'nao'.
WITH fn AS (
  SELECT p.proname::text AS nome, md5(replace(p.prosrc, chr(13), '')) AS h
    FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('devolver_estoque', 'admin_devolucao_concluir')
), forma AS (
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attname) AS f
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = to_regclass('public.pecas_sem_tamanho') AND a.attnum > 0 AND NOT a.attisdropped
), premissas AS (
  SELECT to_regprocedure('public.is_admin()') IS NOT NULL
         AND to_regprocedure('public.is_admin_atual()') IS NOT NULL
         AND (SELECT count(*) FROM pg_catalog.pg_attribute a
               WHERE NOT a.attisdropped
                 AND ((a.attrelid = to_regclass('public.produtos') AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype)
                   OR (a.attrelid = to_regclass('public.marketplace_orders') AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype)
                   OR (a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('id', 'product_id') AND a.atttypid = 'uuid'::regtype)
                   OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'active' AND a.atttypid = 'boolean'::regtype)
                   OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'stock_increment' AND a.atttypid = 'integer'::regtype)
                   OR (a.attrelid = to_regclass('public.devolucao_itens') AND a.attname IN ('id', 'order_item_id', 'product_id') AND a.atttypid = 'uuid'::regtype)
                   OR (a.attrelid = to_regclass('public.devolucao_itens') AND a.attname = 'quantidade' AND a.atttypid = 'integer'::regtype))) = 10 AS certas
), itens(item, esperado, vivo, ok) AS (
  SELECT 'devolver_estoque: corpo da 20261389100000 ou desta (md5)',
         '943b226906e91013e7cccf4992617e35 ou 80b1a90baf10d1b4c59484772e4864c4',
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque'), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'devolver_estoque') IN ('943b226906e91013e7cccf4992617e35', '80b1a90baf10d1b4c59484772e4864c4'), false)
  UNION ALL
  SELECT 'admin_devolucao_concluir: corpo da 20261395200000 ou desta (md5)',
         'a152c8dcd7cf6d1e05e5aff128d6c45e ou 1a548896acb8248f1b1771d765c92fcb',
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir'), 'AUSENTE'),
         COALESCE((SELECT h FROM fn WHERE nome = 'admin_devolucao_concluir') IN ('a152c8dcd7cf6d1e05e5aff128d6c45e', '1a548896acb8248f1b1771d765c92fcb'), false)
  UNION ALL
  SELECT 'pecas_sem_tamanho: ausente ou com a forma desta (11 colunas)', 'sim',
         CASE WHEN forma.f IS NULL THEN 'AUSENTE'
              WHEN forma.f = 'criada_em:timestamp with time zone:true,devolucao_item_id:uuid:false,id:uuid:true,order_id:uuid:false,order_item_id:uuid:false,origem:text:true,produto_id:uuid:true,resolucao:text:false,resolvida_em:timestamp with time zone:false,resolvida_por:uuid:false,variant_id:uuid:false' THEN 'sim'
              ELSE 'nao' END,
         forma.f IS NULL
         OR forma.f = 'criada_em:timestamp with time zone:true,devolucao_item_id:uuid:false,id:uuid:true,order_id:uuid:false,order_item_id:uuid:false,origem:text:true,produto_id:uuid:true,resolucao:text:false,resolvida_em:timestamp with time zone:false,resolvida_por:uuid:false,variant_id:uuid:false'
  FROM forma
  UNION ALL
  SELECT 'is_admin() e is_admin_atual() existem; produtos, pedidos, variacoes e itens da devolucao tem as colunas que os corpos leem', 'sim',
         CASE WHEN premissas.certas THEN 'sim' ELSE 'nao' END,
         COALESCE(premissas.certas, false)
  FROM premissas
)
SELECT item, esperado, vivo, ok FROM itens ORDER BY ok, item;
