
-- ROLLBACK DESTRUTIVO 20261450000000 - SO COM O DONO.
-- Apaga public.fornecedores (os contatos, os links e as observacoes de fornecedores da loja). O rollback comum preserva a
-- tabela. Faca copia antes: SELECT * FROM public.fornecedores; Depois de apagar, a loja volta ao estado "sem fornecedores
-- cadastrados" e os contatos NAO tem como ser recuperados. Os produtos nao sao afetados (nada liga fornecedor a produto nesta etapa).
-- So depois do rollback comum (rollback-manual-20261450000000_a_loja_guarda_os_fornecedores.sql), numa transacao do caller, com
-- confirmacao explicita (SET LOCAL vale so ate o fim da transacao; um SET sem LOCAL ficaria na sessao inteira e confirmaria o
-- apagamento de uma chamada futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_fornecedores = 'APAGAR';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261450000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_fornecedores', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'FORNECEDORES_SO_COM_O_DONO: confirme antes de apagar public.fornecedores.';
  END IF;
  IF to_regprocedure('public.fornecedores_carimba_atualizado_em()') IS NOT NULL
     OR (to_regclass('public.fornecedores') IS NOT NULL
         AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.fornecedores'))) THEN
    RAISE EXCEPTION 'FORNECEDORES_ROLLBACK_COMUM_PRIMEIRO: tire a funcao, o gatilho e as politicas (rollback comum) antes de apagar a tabela.';
  END IF;
END $destrutivo_20261450000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP TABLE IF EXISTS public.fornecedores;

NOTIFY pgrst, 'reload schema';
