-- 8g — O cron `reconciliar-pagamentos` está agendado, ativo, e qual foi a ÚLTIMA
-- execução dele (usado no escoamento antes da 20261201: "uma execução completa
-- do cron já com a edge nova").
-- SÓ LEITURA, um único SELECT. NUNCA seleciona `command` nem `return_message`:
-- o comando do job monta a chamada HTTP lendo segredos do vault, e a mensagem de
-- retorno pode trazer trecho de resposta. Só nome, agenda, ativo, status e
-- horários saem daqui.
--
-- LIMITE HONESTO DO QUE `succeeded` PROVA: o job do pg_cron só ENFILEIRA a
-- chamada (`net.http_post`) — `status = succeeded` diz que o SQL do job rodou, não
-- que a edge respondeu 200. Para saber se a edge terminou bem, olhar o log da
-- função `reconciliar-pagamentos` (ou `net._http_response`, que esta consulta não
-- lê de propósito). O que esta consulta responde com certeza é: o job existe, está
-- ativo e RODOU em tal horário.
--
-- VISIBILIDADE (importante): `cron.job` e `cron.job_run_details` têm RLS no
-- pg_cron ("usuário vê só os jobs que ele criou"), e o papel só-leitura NÃO é o
-- dono dos jobs — então ele pode ver ZERO jobs mesmo com o job rodando. Por isso
-- os controles vêm antes: `jobs visiveis em cron.job` > 0 e `execucoes visiveis`
-- > 0. Controle reprovado = a consulta NÃO consegue concluir daqui (0 jobs
-- visíveis não é "o job não existe"): conferir pelo painel do Supabase (Database ->
-- Cron) ou pelo log da edge.
--
-- Saída: item | esperado | vivo | ok (ok = false primeiro). As linhas
-- `informativo` repetem o valor nas duas colunas.
WITH vis AS (
  SELECT count(*) AS jobs_visiveis FROM cron.job
), j AS (
  SELECT jobid, jobname, schedule, active
    FROM cron.job
   WHERE jobname = 'reconciliar-pagamentos'
), runs AS (
  SELECT d.status, d.start_time, d.end_time
    FROM cron.job_run_details d
    JOIN j ON j.jobid = d.jobid
), ult AS (
  SELECT status, start_time, end_time FROM runs ORDER BY start_time DESC NULLS LAST LIMIT 1
), r(item, esperado, vivo) AS (
  SELECT 'controle: papel pode ler cron.job', 'true',
         has_table_privilege(current_user, 'cron.job', 'SELECT')::text
  UNION ALL
  SELECT 'controle: papel pode ler cron.job_run_details', 'true',
         has_table_privilege(current_user, 'cron.job_run_details', 'SELECT')::text
  UNION ALL
  SELECT 'controle: jobs visiveis em cron.job', '>0',
         CASE WHEN jobs_visiveis > 0 THEN '>0' ELSE '0' END
    FROM vis
  UNION ALL
  SELECT 'job reconciliar-pagamentos existe (linhas visiveis)', '1',
         (SELECT count(*) FROM j)::text
  UNION ALL
  SELECT 'job reconciliar-pagamentos ativo', 'true',
         COALESCE((SELECT bool_and(active) FROM j), false)::text
  UNION ALL
  SELECT 'informativo: agenda (schedule)', COALESCE((SELECT min(schedule) FROM j), '-'), COALESCE((SELECT min(schedule) FROM j), '-')
  UNION ALL
  SELECT 'execucoes visiveis deste job', '>0',
         CASE WHEN (SELECT count(*) FROM runs) > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'ultima execucao: status', 'succeeded', COALESCE((SELECT status FROM ult), 'NENHUMA')
  UNION ALL
  SELECT 'informativo: ultima execucao comecou em',
         COALESCE((SELECT start_time::text FROM ult), '-'), COALESCE((SELECT start_time::text FROM ult), '-')
  UNION ALL
  SELECT 'informativo: ultima execucao terminou em',
         COALESCE((SELECT end_time::text FROM ult), '-'), COALESCE((SELECT end_time::text FROM ult), '-')
  UNION ALL
  SELECT 'informativo: minutos desde o inicio da ultima execucao',
         COALESCE((SELECT round(extract(epoch FROM (now() - start_time)) / 60)::text FROM ult), '-'),
         COALESCE((SELECT round(extract(epoch FROM (now() - start_time)) / 60)::text FROM ult), '-')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM r
 ORDER BY ok, item;
