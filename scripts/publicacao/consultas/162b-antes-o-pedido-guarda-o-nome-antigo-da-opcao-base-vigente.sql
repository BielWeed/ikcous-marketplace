-- ANTES da 20261406000000. So catalogo, sem ler dados de cliente.
-- A base tambem aceita as duas colunas inertes deixadas pelo rollback.
WITH itens(item, ok) AS (
  VALUES
    ('historico da opcao: tabelas, RLS dos itens e colunas de origem', (EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public.marketplace_order_items')
        AND c.relkind = 'r' AND c.relrowsecurity)
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('public.product_variants', 'id', 'uuid'::regtype, true),
          ('public.product_variants', 'name', 'text'::regtype, true),
          ('public.product_variants', 'value', 'text'::regtype, true),
          ('public.marketplace_order_items', 'variant_id', 'uuid'::regtype, false)
        ) AS e(tabela, coluna, tipo, obrigatoria)
        WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(e.tabela)
          AND a.attname = e.coluna AND NOT a.attisdropped AND a.atttypid = e.tipo
          AND a.attnotnull = e.obrigatoria)
      ))),
    ('historico da opcao: colunas de destino', ((SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_order_items')
          AND a.attname IN ('variacao_nome_na_compra', 'variacao_valor_na_compra')
          AND NOT a.attisdropped) = 0 OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_order_items')
          AND a.attname IN ('variacao_nome_na_compra', 'variacao_valor_na_compra')
          AND NOT a.attisdropped
          AND a.atttypid = 'text'::regtype AND NOT a.attnotnull AND NOT a.atthasdef
          AND a.attidentity = '' AND a.attgenerated = '' AND a.attacl IS NULL) = 2)),
    ('historico da opcao: funcao interna', (NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname = 'guardar_rotulo_da_opcao_no_pedido'))),
    ('historico da opcao: gatilho de nome ou valor', (NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.product_variants')
        AND t.tgname = 'tr_product_variants_guarda_rotulo_no_pedido')))
)
SELECT item, 'sim' AS esperado, CASE WHEN ok THEN 'sim' ELSE 'nao' END AS vivo,
       COALESCE(ok, false) AS ok
FROM itens ORDER BY ok, item;
