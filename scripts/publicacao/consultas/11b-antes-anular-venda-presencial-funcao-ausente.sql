-- 11b — ANTES de aplicar a migration 20261204000000 (a venda do balcao se anula no
-- mesmo dia): confirma que a funcao `anular_venda_presencial` ainda NAO existe e que
-- tudo de que o pre-voo da migration depende ESTA no banco, com o corpo esperado. E' a
-- consulta de AUSENCIA do lote (`ausenciaConfirmadaPor` em
-- scripts/frota/canais-de-backend.json): so com a 11a NEGATIVA e esta POSITIVA (da mesma
-- janela ou mais nova) o portao imprime o apply do arquivo 20261204000000.
-- SO LEITURA, um unico SELECT, so catalogo: nenhuma linha de pedido, venda ou cliente.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de
-- 9 linhas, as mesmas em qualquer estado do banco.
--
-- O QUE CADA LINHA PROVA (as mesmas condicoes do `DO $preflight_20261204$` da migration)
--   * funcao ausente   -- zero sobrecargas de `anular_venda_presencial` (se ja existe, a
--                         migration so reaplica quando o corpo e' o dela; aqui a ausencia
--                         e' a premissa de "ainda nao aplicada").
--   * is_admin()       -- existe (a primeira porta da funcao; o pre-voo exige).
--   * is_admin_atual() -- corpo (md5 do prosrc sem CR) igual ao da 20261197000000.
--   * pedido__mudar_status -- corpo (md5 sem CR) igual ao da 20261198000000.
--   * devolver_estoque, fin__dia, fin__hoje -- existem.
--   * tabelas e colunas -- as que a funcao le e escreve existem (devolucoes,
--                         order_refunds, os dois historicos e as colunas de
--                         marketplace_orders que ela confere).
-- Nao conta linhas de dado e nao le coluna nenhuma de cliente.
WITH tabelas AS (
  SELECT t.nome, to_regclass('public.' || t.nome) AS oid
    FROM (VALUES ('devolucoes'), ('order_refunds'), ('marketplace_order_history'),
                 ('marketplace_order_payment_history'), ('marketplace_orders')) AS t(nome)
), colunas AS (
  SELECT c.tabela, c.coluna,
         EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = to_regclass('public.' || c.tabela)
                    AND a.attname = c.coluna AND a.attnum > 0 AND NOT a.attisdropped) AS existe
    FROM (VALUES ('marketplace_orders', 'canal'), ('marketplace_orders', 'status'),
                 ('marketplace_orders', 'payment_status'), ('marketplace_orders', 'payment_method'),
                 ('marketplace_orders', 'pagamento_recebido_em'),
                 ('marketplace_orders', 'estorno_manual_registrado_em'),
                 ('marketplace_orders', 'gateway_payment_id'), ('marketplace_orders', 'metodo_online'),
                 ('marketplace_orders', 'valor_estornado'),
                 ('marketplace_order_payment_history', 'acao'),
                 ('marketplace_order_payment_history', 'payment_status_antes'),
                 ('marketplace_order_payment_history', 'payment_status_depois'),
                 ('devolucoes', 'order_id'), ('devolucoes', 'status'),
                 ('order_refunds', 'order_id'), ('order_refunds', 'status')) AS c(tabela, coluna)
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'anular_venda_presencial: ausente', '0',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'anular_venda_presencial')
  UNION ALL
  SELECT 'dependencia is_admin(): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.is_admin()') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia is_admin_atual(): corpo e o esperado (md5)',
         '519842163e48cc377ac1337ffb9db936',
         COALESCE((SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.is_admin_atual()')), 'AUSENTE')
  UNION ALL
  SELECT 'dependencia pedido__mudar_status(...): corpo e o esperado (md5)',
         '4623b27a07468553d6ac00a888e04db4',
         COALESCE((SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p
                    WHERE p.oid = to_regprocedure('public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)')), 'AUSENTE')
  UNION ALL
  SELECT 'dependencia devolver_estoque(uuid): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.devolver_estoque(uuid)') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia fin__dia e fin__hoje: existem', 'EXISTEM',
         CASE WHEN to_regprocedure('public.fin__dia(timestamptz)') IS NOT NULL
                AND to_regprocedure('public.fin__hoje()') IS NOT NULL
              THEN 'EXISTEM' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'tabelas usadas: existem', 'TODAS',
         CASE WHEN (SELECT bool_and(t.oid IS NOT NULL) FROM tabelas t) THEN 'TODAS'
              ELSE 'FALTA: ' || (SELECT string_agg(t.nome, ',' ORDER BY t.nome) FROM tabelas t WHERE t.oid IS NULL) END
  UNION ALL
  SELECT 'colunas usadas: existem', 'TODAS',
         CASE WHEN (SELECT bool_and(c.existe) FROM colunas c) THEN 'TODAS'
              ELSE 'FALTA: ' || (SELECT string_agg(c.tabela || '.' || c.coluna, ',' ORDER BY c.tabela, c.coluna)
                                   FROM colunas c WHERE NOT c.existe) END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
