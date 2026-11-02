-- ROLLBACK DESTRUTIVO 20261399000000 - SO COM O DONO.
-- Apaga public.visitas_por_dia (a contagem de entradas da loja, por dia e canal). O rollback comum preserva a tabela.
-- Faca copia antes: SELECT * FROM public.visitas_por_dia ORDER BY dia, canal;
-- Nao ha PITR e a contagem nao se reconstroi: a entrada de ontem so existe aqui.
-- So depois do rollback comum (rollback-manual-20261399000000_as_visitas_da_loja_contam_pelo_porteiro.sql), numa transacao do caller,
-- com confirmacao explicita:
--   SET app.confirmo_apagar_visitas_da_loja = 'APAGAR';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261399000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_visitas_da_loja', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'VISITAS_DA_LOJA_SO_COM_O_DONO: confirme antes de apagar visitas_por_dia.';
  END IF;
  IF to_regprocedure('public.contar_entrada(text)') IS NOT NULL
     OR to_regprocedure('public.crm_visitas(date, date)') IS NOT NULL THEN
    RAISE EXCEPTION 'VISITAS_DA_LOJA_ROLLBACK_COMUM_PRIMEIRO: tire as funcoes (rollback comum) antes de apagar a tabela.';
  END IF;
END $destrutivo_20261399000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP TABLE IF EXISTS public.visitas_por_dia;

NOTIFY pgrst, 'reload schema';
