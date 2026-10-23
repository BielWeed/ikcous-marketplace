-- ROLLBACK DESTRUTIVO 20261383000000 - SO COM O DONO.
-- Apaga public.dono_da_loja (quem e' o dono da loja) e public.cargo_log (o historico de quem mudou o cargo de quem).
-- O rollback comum preserva as duas tabelas. Faca copia antes: SELECT * FROM public.dono_da_loja; SELECT * FROM public.cargo_log;
-- Sem o historico, nao ha como provar depois quem nomeou quem.
-- (Lembrete: com dono_da_loja de pe, apagar a conta do dono e' bloqueado pela FK ON DELETE RESTRICT; trocar o dono = DELETE + novo INSERT.)
-- So depois do rollback comum (rollback-manual-20261383000000_so_o_dono_da_loja_define_cargo.sql), numa transacao do caller,
-- com confirmacao explicita:
--   SET app.confirmo_apagar_cargos = 'APAGAR';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261383000000$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_cargos', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'CARGOS_SO_COM_O_DONO: confirme antes de apagar dono_da_loja e cargo_log.';
  END IF;
  IF to_regprocedure('public.definir_cargo(uuid,text)') IS NOT NULL
     OR to_regprocedure('public.papel_so_pelo_definir_cargo()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.profiles') AND tgname = 'tr_papel_so_pelo_definir_cargo'
                  AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'CARGOS_ROLLBACK_COMUM_PRIMEIRO: tire o gatilho e as funcoes (rollback comum) antes de apagar as tabelas.';
  END IF;
END $destrutivo_20261383000000$;

-- Sem CASCADE: dependente que escapou faz o Postgres recusar em vez de apagar o objeto junto.
DROP TABLE IF EXISTS public.cargo_log;
DROP TABLE IF EXISTS public.dono_da_loja;

NOTIFY pgrst, 'reload schema';
