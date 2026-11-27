-- ROLLBACK COMUM da 20261610000000_o_catalogo_e_a_configuracao_chegam_ao_vivo_em_toda_loja.sql: NAO tira nada da publicacao.
-- A migration so pos tabelas na publicacao supabase_realtime (nenhuma funcao, coluna, politica, grant ou linha). O unico jeito de "desfazer"
-- e' tirar as 10 da publicacao, e isso NAO e' seguro sem o dono: o catalogo nao guarda se a tabela estava la antes da migration (na IKCOUS
-- as 10 ja estavam, postas a mao; tirar desligaria o ao vivo da loja de desenvolvimento). Entao este arquivo, o que roda sem confirmacao
-- (inclusive na pilha de rollbacks da prova (h) de tests/banco/ordem-das-travas-composta-viva.cjs), so CONFERE e AVISA: le a publicacao,
-- diz por NOTICE quantas das 10 estao nela e aponta o degrau que tira. Nenhum ALTER, nenhuma escrita; rodar quantas vezes for deixa o mesmo
-- estado; nunca recusa (sem a publicacao, ou FOR ALL TABLES, so avisa).
-- TIRAR DO AO VIVO e' outro arquivo, rollback-manual-destrutivo-20261610000000_o_catalogo_e_a_configuracao_chegam_ao_vivo_em_toda_loja.sql,
-- SO COM O DONO, so em loja que nao tinha NENHUMA das 10 antes do apply, com SET LOCAL app.confirmo_tirar_do_realtime_20261610 = 'TIRAR'.
-- Sem BEGIN/COMMIT (regra da casa: quem roda abre a transacao).

DO $rollback_comum_20261610000000$
DECLARE
  v_dez CONSTANT text[] := ARRAY['answers', 'banners', 'cart_items', 'categorias', 'favorites', 'product_variants', 'produtos',
                                 'questions', 'reviews', 'store_config'];
  v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'rollback comum 20261610000000: a publicacao supabase_realtime nao existe neste banco; nada a conferir.';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_publication_tables pt
   WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public' AND pt.tablename = ANY (v_dez);
  RAISE NOTICE 'rollback comum 20261610000000: % das 10 tabelas estao na publicacao supabase_realtime; nada foi tirado. Tirar do ao vivo e'' o rollback-manual-destrutivo-20261610000000, so com o dono.', v_n;
END
$rollback_comum_20261610000000$;
