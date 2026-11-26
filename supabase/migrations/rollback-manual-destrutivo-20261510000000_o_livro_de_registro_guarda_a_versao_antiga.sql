-- ROLLBACK DESTRUTIVO 20261510000000 - SO COM O DONO.
-- Apaga public.livro_de_registro (as versoes antigas de pedidos, produtos, cupons, devolucoes, caixa e configuracoes dos ultimos 90
-- dias), public.livro_de_registro_falhas, public.livro_de_registro_chave e a funcao public.livro_de_registro_limpar(). O rollback comum
-- PRESERVA tudo isso. Depois de apagar, o que estava no livro NAO tem como ser recuperado (nao ha copia em lugar nenhum). Nenhuma das
-- 17 tabelas de origem e' tocada.
-- So depois do rollback comum (rollback-manual-20261510000000_o_livro_de_registro_guarda_a_versao_antiga.sql), numa transacao do
-- caller, com confirmacao explicita (SET LOCAL vale so ate o fim da transacao; um SET sem LOCAL ficaria na sessao inteira e
-- confirmaria o apagamento de uma chamada futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_livro = 'APAGAR';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261510000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_livro', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'LIVRO_SO_COM_O_DONO: confirme antes de apagar o livro de registro (SET LOCAL app.confirmo_apagar_livro = ''APAGAR'').';
  END IF;
  IF to_regprocedure('public.livro_de_registro_anotar()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE NOT t.tgisinternal AND t.tgname IN ('tr_livro_alteracao', 'tr_livro_exclusao')) THEN
    RAISE EXCEPTION 'LIVRO_ROLLBACK_COMUM_PRIMEIRO: tire os gatilhos e a funcao (rollback comum) antes de apagar o livro.';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpar-livro-de-registro') THEN
      RAISE EXCEPTION 'LIVRO_ROLLBACK_COMUM_PRIMEIRO: o job limpar-livro-de-registro ainda esta agendado (rollback comum antes).';
    END IF;
  END IF;
END $destrutivo_20261510000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP FUNCTION IF EXISTS public.livro_de_registro_limpar();
DROP TABLE IF EXISTS public.livro_de_registro;
DROP TABLE IF EXISTS public.livro_de_registro_falhas;
DROP TABLE IF EXISTS public.livro_de_registro_chave;

NOTIFY pgrst, 'reload schema';
