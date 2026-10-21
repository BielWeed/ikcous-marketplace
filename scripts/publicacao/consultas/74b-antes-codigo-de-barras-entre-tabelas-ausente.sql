-- ANTES da 20261347000000; SO LEITURA, somente catalogo, rol fechado de 3 linhas. Exige a base pronta e os objetos novos AUSENTES.
-- Rollback remove os 4 objetos, entao a ausencia depois dele e legitima (a 81b volta a ser positiva; nenhum dado e tocado).
WITH itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'codigo_barras: colunas e indices unicos por tabela', 'sim', CASE WHEN COALESCE(
    (SELECT count(*) FROM pg_attribute a WHERE NOT a.attisdropped
       AND ((a.attrelid = to_regclass('public.produtos') AND a.attname = 'codigo_barras' AND a.atttypid = 'text'::regtype)
         OR (a.attrelid = to_regclass('public.product_variants') AND a.attname = 'codigo_barras' AND a.atttypid = 'text'::regtype)
         OR (a.attrelid = to_regclass('public.produtos') AND a.attname = 'deleted_at' AND a.atttypid = 'timestamptz'::regtype))) = 3
    AND pg_get_indexdef(to_regclass('public.produtos_codigo_barras_unico')) = 'CREATE UNIQUE INDEX produtos_codigo_barras_unico ON public.produtos USING btree (codigo_barras) WHERE ((codigo_barras IS NOT NULL) AND (deleted_at IS NULL))'
    AND pg_get_indexdef(to_regclass('public.product_variants_codigo_barras_unico')) = 'CREATE UNIQUE INDEX product_variants_codigo_barras_unico ON public.product_variants USING btree (codigo_barras) WHERE (codigo_barras IS NOT NULL)'
    AND (SELECT count(*) FROM pg_index i WHERE i.indexrelid IN (to_regclass('public.produtos_codigo_barras_unico'), to_regclass('public.product_variants_codigo_barras_unico'))
       AND i.indisunique AND i.indisvalid AND i.indisready) = 2, false) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'gatilhos de codigo de barras: funcoes e gatilhos ausentes', 'sim', CASE WHEN
    NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('produto_codigo_barras_livre_de_variacao', 'variacao_codigo_barras_livre_de_produto'))
    AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('tr_produto_codigo_barras_livre_de_variacao', 'tr_variacao_codigo_barras_livre_de_produto'))
    THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
