-- Parte (e.3) do runbook docs/runbooks/migrar-banco-da-loja.md — recria, no
-- projeto NOVO, os 3 jobs do pg_cron que a restauração da parte (b) não
-- trouxe (`cron.job` restaurou 0 linhas: "permission denied for table job" —
-- é uma tabela de extensão, o dump lógico não conseguiu gravar dado nela
-- com o papel que restaurou).
--
-- É CÓPIA, byte a byte do corpo (`$cron$ ... $cron$`), dos três
-- `cron.schedule(...)` que já estão nas migrations — não inventa
-- agendamento novo, não muda cadência:
--   supabase/migrations/20260807000001_agenda_expiracao.sql
--   supabase/migrations/20260808000100_reconciliacao.sql
--   supabase/migrations/20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql
--
-- PRÉ-REQUISITO: os segredos do Vault `reconciliacao_url` e
-- `reconciliacao_secret` precisam existir ANTES de rodar isto — o job
-- `reconciliar-pagamentos` lê os dois em TODA execução (não só na hora de
-- agendar). Ver a tabela de segredos no runbook, parte (e.3).
--
-- Idempotente: cada bloco começa com `cron.unschedule` do mesmo nome (roda
-- de novo sem duplicar job).

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1) expirar-pedidos-vencidos --------------------------------------------
SELECT cron.unschedule('expirar-pedidos-vencidos')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'expirar-pedidos-vencidos'
);

SELECT cron.schedule(
  'expirar-pedidos-vencidos',
  '*/5 * * * *',
  $cron$ SELECT public.expirar_pedidos_vencidos(); $cron$
);

-- 2) reconciliar-pagamentos ------------------------------------------------
SELECT cron.unschedule('reconciliar-pagamentos')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'reconciliar-pagamentos'
);

SELECT cron.schedule(
    'reconciliar-pagamentos',
    '*/10 * * * *',
    $cron$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets
                     WHERE name = 'reconciliacao_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-reconciliacao-secret',
            (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'reconciliacao_secret')
        ),
        body    := '{}'::jsonb,
        timeout_milliseconds := 120000
    ) AS request_id;
    $cron$
);

-- 3) devolver-cupons-de-pedidos-mortos -------------------------------------
SELECT cron.unschedule('devolver-cupons-de-pedidos-mortos')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'devolver-cupons-de-pedidos-mortos'
);

SELECT cron.schedule(
  'devolver-cupons-de-pedidos-mortos',
  '*/15 * * * *',
  $cron$ SELECT public.devolver_cupons_de_pedidos_mortos(); $cron$
);

-- Confirma: espera as 3 linhas acima, nesta ordem de criação (não
-- necessariamente esta ordem na saída — ORDER BY jobname para comparar
-- com a tabela do runbook).
\echo '=== jobs do pg_cron depois de recriar ==='
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
