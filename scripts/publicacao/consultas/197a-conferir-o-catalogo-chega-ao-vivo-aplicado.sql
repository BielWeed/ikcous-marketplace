-- 197a-conferir-o-catalogo-chega-ao-vivo-aplicado: DEPOIS da 20261610000000 (o catalogo e a configuracao chegam ao vivo em toda loja). SO LEITURA,
-- somente catalogo, rol fechado de 6 linhas. Nao le nenhuma linha de tabela. Prova na publicacao supabase_realtime as 10 tabelas desta migration e
-- as 3 da 20261061, e nenhuma outra do esquema public alem delas e de coupons, que e' TOLERADA (nem exigida nem proibida: a IKCOUS a tem, posta a
-- mao; a migration nao a poe). Positiva com 13 (a Savy e a loja nova depois do apply) e com 14 (a IKCOUS). A RLS tem de estar ligada nas 10 e em
-- coupons se ela estiver publicada (sem RLS o realtime entregaria toda linha a todo assinante). ATENCAO: na IKCOUS as 10 ja estavam na publicacao,
-- entao la a 197a sai POSITIVA ANTES do apply; na Savy e na loja nova ela sai "nao" (no item das 10) antes, nunca erro.
WITH dez(t) AS (
  VALUES ('answers'), ('banners'), ('cart_items'), ('categorias'), ('favorites'), ('product_variants'), ('produtos'), ('questions'), ('reviews'),
         ('store_config')
), permitidas(t) AS (
  SELECT t FROM dez UNION ALL VALUES ('marketplace_orders'), ('marketplace_order_items'), ('notificacoes'), ('coupons')
), publicadas AS (
  SELECT pt.tablename::text AS t FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: catalogo publico visivel', 'sim', CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'a publicacao supabase_realtime existe, nao e FOR ALL TABLES e publica INSERT, UPDATE e DELETE', 'sim', CASE WHEN EXISTS (
    SELECT 1 FROM pg_publication p WHERE p.pubname = 'supabase_realtime' AND NOT p.puballtables AND p.pubinsert AND p.pubupdate AND p.pubdelete)
    THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 10 tabelas do catalogo e da configuracao estao na publicacao', 'sim', CASE WHEN
    (SELECT count(*) FROM dez d WHERE d.t IN (SELECT t FROM publicadas)) = 10 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 3 tabelas da 20261061000000 (pedido, item do pedido, notificacao) continuam na publicacao', 'sim', CASE WHEN
    (SELECT count(*) FROM publicadas WHERE t IN ('marketplace_orders', 'marketplace_order_items', 'notificacoes')) = 3 THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'nenhuma outra tabela do esquema public esta na publicacao (so as 13 e coupons, tolerada)', 'sim', CASE WHEN NOT EXISTS (
    SELECT 1 FROM publicadas WHERE t NOT IN (SELECT t FROM permitidas)) THEN 'sim' ELSE 'nao' END
  UNION ALL SELECT 'as 10 tabelas existem com RLS ligada (e coupons, se publicada)', 'sim', CASE WHEN
    (SELECT count(*) FROM dez d JOIN pg_class k ON k.relnamespace = 'public'::regnamespace AND k.relname = d.t AND k.relkind = 'r' AND k.relrowsecurity) = 10
    AND NOT EXISTS (SELECT 1 FROM publicadas p JOIN pg_class k ON k.relnamespace = 'public'::regnamespace AND k.relname = p.t
                     WHERE p.t = 'coupons' AND NOT k.relrowsecurity)
    THEN 'sim' ELSE 'nao' END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok FROM itens ORDER BY ok, item;
