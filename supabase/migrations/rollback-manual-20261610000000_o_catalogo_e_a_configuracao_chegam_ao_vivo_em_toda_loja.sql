-- ROLLBACK MANUAL de 20261610000000_o_catalogo_e_a_configuracao_chegam_ao_vivo_em_toda_loja.sql.
--
-- Tira da publicacao supabase_realtime as 10 tabelas que a migration poe (answers, banners, cart_items, categorias, favorites,
-- product_variants, produtos, questions, reviews, store_config). coupons (que a migration nao poe) e as 3 da 20261061
-- (notificacoes, marketplace_orders, marketplace_order_items) NAO sao tocadas. Replica identity nao muda (a migration nao a mudou).
-- Nenhuma linha e' lida ou apagada.
--
-- ⚠️ SO PARA LOJA QUE NAO TINHA NENHUMA DAS 10 ANTES DO APPLY (197b antes do apply com 0 das 10 publicadas): a Savy (medida em
--    27/11/2026 com so as 3) e loja nova do instalador. A 197b positiva sozinha NAO basta (ela diz "pelo menos uma fora"): a contagem
--    de antes tem de ter sido 0, medida com
--      SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
--         AND tablename IN ('answers', 'banners', 'cart_items', 'categorias', 'favorites', 'product_variants', 'produtos',
--                           'questions', 'reviews', 'store_config');
--    (ou o bloco 7 da 18a-inventario-de-portas). Loja que tinha parte delas antes: este arquivo tiraria tambem as que ja estavam;
--    nao rode, desfaca a mao so as que a migration pos.
-- ⚠️ NUNCA NA IKCOUS (CAF): la as 10 ja estavam na publicacao ANTES desta migration (postas a mao); o estado de antes e' "dentro",
--    e tirar desligaria o ao vivo da loja de desenvolvimento. O catalogo nao guarda quem pos a tabela, entao este arquivo nao tem
--    como distinguir as lojas sozinho: a guarda e' a confirmacao explicita de quem roda, numa transacao do caller
--    (SET LOCAL vale so ate o fim da transacao; um SET sem LOCAL ficaria na sessao inteira):
--      SET LOCAL app.confirmo_tirar_do_realtime_20261610 = 'TIRAR';
--
-- Depois dele a loja volta ao defeito (o segundo aparelho nao ve ao vivo produto, configuracao, variacao, categoria nem banner), e a
-- 197b volta a dizer "sim" e a 197a "nao". Idempotente: so tira a tabela que esta na publicacao; rodar de novo nao erra.
-- Publicacao FOR ALL TABLES: recusa (nao se tira tabela dela). Sem a publicacao: NOTICE e nada.
-- SEM BEGIN/COMMIT (regra da casa: quem roda abre a transacao).

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $rollback_20261610000000$
DECLARE
  v_dez CONSTANT text[] := ARRAY['answers', 'banners', 'cart_items', 'categorias', 'favorites', 'product_variants', 'produtos',
                                 'questions', 'reviews', 'store_config'];
  v_tabela text;
BEGIN
  IF COALESCE(current_setting('app.confirmo_tirar_do_realtime_20261610', true), '') <> 'TIRAR' THEN
    RAISE EXCEPTION 'REALTIME_SO_LOJA_QUE_NAO_TINHA: este rollback tira o ao vivo de 10 tabelas; so vale em loja que NAO tinha nenhuma delas na publicacao antes da 20261610000000 (nunca na IKCOUS). Confirme com SET LOCAL app.confirmo_tirar_do_realtime_20261610 = ''TIRAR''.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'rollback 20261610000000: a publicacao supabase_realtime nao existe neste banco; nada a fazer.';
    RETURN;
  END IF;
  IF (SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a publicacao supabase_realtime e FOR ALL TABLES; nao se tira tabela dela, e nao foi esta migration que a fez assim.';
  END IF;

  FOREACH v_tabela IN ARRAY v_dez LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = v_tabela
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_tabela);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables pt
     WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public' AND pt.tablename = ANY (v_dez)
  ) THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: alguma das 10 tabelas continuou na publicacao supabase_realtime.';
  END IF;
END
$rollback_20261610000000$;
