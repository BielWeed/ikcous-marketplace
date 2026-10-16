-- ROLLBACK DESTRUTIVO 20261246000000 — SÓ COM O DONO.
-- Apaga chaves e ids guardados: reenviar depois de reaplicar poderá duplicar lançamentos.
-- Faça cópia dos registros antes. O rollback comum preserva esses dados.
-- Só depois do rollback comum, numa transação do caller, com confirmação explícita:
-- SET app.confirmo_apagar_tentativas_financeiras = 'APAGAR';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261246$
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_tentativas_financeiras', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'TENTATIVAS_FINANCEIRAS_SO_COM_O_DONO: confirme antes de apagar as tentativas.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
               AND p.prosrc LIKE '%fin_lancamento_tentativas%')
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
          WHERE oid = to_regprocedure('public.fin_lancamento_salvar(jsonb)')) IS DISTINCT FROM '559a13a9d69e02e5048623685cd07514' THEN
    RAISE EXCEPTION 'TENTATIVAS_FINANCEIRAS_ROLLBACK_COMUM_PRIMEIRO: devolva o corpo anterior antes de apagar a tabela.';
  END IF;
END $destrutivo_20261246$;

DROP TABLE IF EXISTS public.fin_lancamento_tentativas;
