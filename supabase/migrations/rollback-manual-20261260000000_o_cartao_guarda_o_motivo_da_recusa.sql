-- Rollback manual da 20261260000000. Reverter as edges antes.
-- Remove SOMENTE a tabela criada por esta migration, com seus indices.
-- Se ja houver historico, PARA: apagar dado real exige autorizacao do dono.
-- Sem BEGIN/COMMIT: a transacao pertence ao aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF to_regclass('public.tentativas_cartao_diagnostico') IS NULL
     OR obj_description(to_regclass('public.tentativas_cartao_diagnostico'), 'pg_class')
       IS DISTINCT FROM 'cartao_diagnostico_20261260000000' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: tabela ausente ou nao identificada como criada pela 20261260000000.';
  END IF;
END $preflight$;

LOCK TABLE public.tentativas_cartao_diagnostico IN ACCESS EXCLUSIVE MODE;
DO $sem_dado$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tentativas_cartao_diagnostico) THEN
    RAISE EXCEPTION 'HISTORICO_EXISTENTE: rollback recusado para nao apagar tentativas; exige decisao do dono.';
  END IF;
END $sem_dado$;
DROP TABLE public.tentativas_cartao_diagnostico;
