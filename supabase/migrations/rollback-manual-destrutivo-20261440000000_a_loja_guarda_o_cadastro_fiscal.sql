-- ROLLBACK DESTRUTIVO 20261440000000 - SO COM O DONO.
-- Apaga public.fiscal_cadastro (o regime e a atividade fiscais da loja) e public.fiscal_cadastro_log (a trilha de quem mudou o
-- que e quando). O rollback comum preserva as duas tabelas. Faca copia antes: SELECT * FROM public.fiscal_cadastro;
-- SELECT * FROM public.fiscal_cadastro_log; Depois de apagar, a loja volta ao estado "sem cadastro fiscal" e o historico de
-- alteracoes nao tem como ser recuperado. As guias lancadas no Financeiro NAO sao afetadas (sao lancamentos normais).
-- So depois do rollback comum (rollback-manual-20261440000000_a_loja_guarda_o_cadastro_fiscal.sql), numa transacao do caller,
-- com confirmacao explicita (SET LOCAL vale so ate o fim da transacao; um SET sem LOCAL ficaria na sessao inteira e
-- confirmaria o apagamento de uma chamada futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_cadastro_fiscal = 'APAGAR';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261440000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_cadastro_fiscal', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'FISCAL_SO_COM_O_DONO: confirme antes de apagar fiscal_cadastro e fiscal_cadastro_log.';
  END IF;
  IF to_regprocedure('public.fiscal_cadastro_salvar(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'FISCAL_ROLLBACK_COMUM_PRIMEIRO: tire a funcao e as politicas (rollback comum) antes de apagar as tabelas.';
  END IF;
END $destrutivo_20261440000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto. A sequencia do identity do log
-- sai junto com a tabela (e' dela).
DROP TABLE IF EXISTS public.fiscal_cadastro_log;
DROP TABLE IF EXISTS public.fiscal_cadastro;

NOTIFY pgrst, 'reload schema';
