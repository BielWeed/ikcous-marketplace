-- ROLLBACK DESTRUTIVO 20261386000000 - SO COM O DONO.
-- Apaga public.produto_historico_preco (o historico de precos dos produtos). O rollback comum preserva a tabela.
-- Faca copia antes: SELECT * FROM public.produto_historico_preco;
-- Nao ha PITR e o historico nao se reconstroi: o preco de ontem so existe aqui. Apagar tambem faz a regra do "De" do passo 2 (se ja
-- estiver no ar) perder a base: tire-a primeiro.
-- So depois do rollback comum (rollback-manual-20261386000000_o_preco_do_produto_deixa_historico.sql), numa transacao do caller,
-- com confirmacao explicita:
--   SET app.confirmo_apagar_historico_de_preco = 'APAGAR';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261386000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_historico_de_preco', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'HISTORICO_DE_PRECO_SO_COM_O_DONO: confirme antes de apagar produto_historico_preco.';
  END IF;
  IF to_regprocedure('public.registrar_historico_de_preco()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.produtos') AND tgname = 'tr_produto_historico_de_preco'
                  AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'HISTORICO_DE_PRECO_ROLLBACK_COMUM_PRIMEIRO: tire o gatilho e a funcao (rollback comum) antes de apagar a tabela.';
  END IF;
END $destrutivo_20261386000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP TABLE IF EXISTS public.produto_historico_preco;

NOTIFY pgrst, 'reload schema';
