-- 197a-conferir-o-catalogo-chega-ao-vivo-aplicado: DEPOIS da 20261610000000 (o catalogo e a configuracao chegam ao vivo em toda loja). SO LEITURA,
-- somente catalogo, rol fechado de 6 linhas. Nao le nenhuma linha de tabela. Prova a publicacao supabase_realtime com EXATAMENTE as 14 tabelas
-- esperadas do esquema public (as 11 desta migration e as 3 da 20261061) e a RLS ligada nas 11 (sem ela o realtime entregaria toda linha a todo
-- assinante). ATENCAO: na IKCOUS as 11 ja estavam na publicacao (postas a mao), entao la a 197a sai POSITIVA ANTES do apply; na Savy e na loja nova
-- ela sai "nao" (no item das 11) antes, nunca erro.
WITH esperadas(t) AS (
  VALUES ('answers'), ('banners'), ('cart_items'), ('categorias'), ('coupons'), ('favorites'), ('product_variants'), ('produtos'), ('questions'),
         ('reviews'), ('store_config'), ('marketplace_orders'), ('marketplace_order_items'), ('notificacoes')
), onze(t) AS (
  SELECT t FROM esperadas WHERE t NOT IN ('marketplace_orders', 'marketplace_order_items', 'notificacoes')
), publicadas AS (
  SELECT pt.tablename::text AS t FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a publicacao supabase_realtime existe, nao e FOR ALL TABLES e publica INSERT, UPDATE e DELETE', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_publication p WHERE p.pubname = 'supabase_realtime' AND NOT p.puballtables AND p.pubinsert AND p.pubupdate AND p.pubdelete)
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 11 tabelas do catalogo e da configuracao estao na publicacao', 'sim', CASE WHEN
    (SELECT count(*) FROM onze o WHERE o.t IN (SELECT t FROM publicadas)) = 11 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 3 tabelas da 20261061000000 (pedido, item do pedido, notificacao) continuam na publicacao', 'sim', CASE WHEN
    (SELECT count(*) FROM publicadas WHERE t IN ('marketplace_orders', 'marketplace_order_items', 'notificacoes')) = 3 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'nenhuma outra tabela do esquema public esta na publicacao (exatamente as 14 esperadas)', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM publicadas WHERE t NOT IN (SELECT t FROM esperadas)) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 11 tabelas existem com RLS ligada', 'sim', CASE WHEN
    (SELECT count(*) FROM onze o JOIN pg_class k ON k.relnamespace = 'public'::regnamespace AND k.relname = o.t AND k.relkind = 'r' AND k.relrowsecurity) = 11
    THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
