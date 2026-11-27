-- 197b-antes-o-catalogo-chega-ao-vivo-ausente: ANTES da 20261610000000 (ou depois do rollback-manual dela). SO LEITURA, somente catalogo, rol
-- fechado de 6 linhas. Nao le nenhuma linha de tabela. Prova que pelo menos uma das 10 tabelas ainda esta fora da publicacao supabase_realtime
-- e as premissas do apply: a publicacao existe e nao e FOR ALL TABLES; as 10 existem com RLS ligada e identidade de replicacao utilizavel
-- (sem ela, publicada, todo UPDATE e DELETE na tabela passaria a errar: o pre-voo da migration recusaria com B1_BASELINE_DIVERGENT); a 20261061
-- ja aplicada (as 3 dentro); e nenhuma tabela publicada alem das 13 e de coupons (tolerada; se houver outra, alguem mexeu a mao: diagnostico
-- antes). Na IKCOUS (as 10 ja dentro) a 197b sai "nao" no item da ausencia; na Savy e na loja nova, positiva. "Pelo menos uma fora" NAO e' "nenhuma
-- dentro": o rollback so vale para loja com 0 das 10 publicadas antes (ver o cabecalho dele).
WITH dez(t) AS (
  VALUES ('answers'), ('banners'), ('cart_items'), ('categorias'), ('favorites'), ('product_variants'), ('produtos'), ('questions'), ('reviews'),
         ('store_config')
), permitidas(t) AS (
  SELECT t FROM dez UNION ALL VALUES ('marketplace_orders'), ('marketplace_order_items'), ('notificacoes'), ('coupons')
), publicadas AS (
  SELECT pt.tablename::text AS t FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'pelo menos uma das 10 tabelas ainda esta fora da publicacao', 'sim', CASE WHEN
    (SELECT count(*) FROM dez d WHERE d.t IN (SELECT t FROM publicadas)) < 10 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'premissa: a publicacao supabase_realtime existe e nao e FOR ALL TABLES', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_publication p WHERE p.pubname = 'supabase_realtime' AND NOT p.puballtables) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'premissa: as 10 tabelas existem com RLS ligada e identidade de replicacao utilizavel (chave primaria, FULL ou indice)', 'sim', CASE WHEN
    (SELECT count(*) FROM dez d JOIN pg_class k ON k.relnamespace = 'public'::regnamespace AND k.relname = d.t AND k.relkind = 'r' AND k.relrowsecurity
      WHERE k.relreplident = 'f'
         OR (k.relreplident = 'd' AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.oid AND i.indisprimary))
         OR (k.relreplident = 'i' AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.oid AND i.indisreplident))) = 10
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'premissa: as 3 tabelas da 20261061000000 ja estao na publicacao', 'sim', CASE WHEN
    (SELECT count(*) FROM publicadas WHERE t IN ('marketplace_orders', 'marketplace_order_items', 'notificacoes')) = 3 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'nenhuma tabela do esquema public alem das 13 e de coupons (tolerada) esta na publicacao', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM publicadas WHERE t NOT IN (SELECT t FROM permitidas)) THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
