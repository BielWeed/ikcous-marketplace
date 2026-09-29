-- Contagens de conferência pós-restauração — parte (c) do runbook
-- docs/runbooks/migrar-banco-da-loja.md.
--
-- SÓ CONTA. Nenhuma linha aqui lê nome, e-mail, telefone, endereço ou
-- qualquer outro dado pessoal — count(*) nunca devolve o dado em si.
--
-- Rode este arquivo DUAS vezes com o mesmo comando (psql -f), trocando só o
-- destino (-d):
--   1. contra o projeto NOVO, depois de restaurar o backup nele (o "de
--      verdade", que a loja vai usar);
--   2. OPCIONAL, mas recomendado: contra um banco Postgres 17 LOCAL e
--      descartável, onde você restaurou o MESMO arquivo de backup (ver
--      "Comparação local" no runbook). Como as duas restaurações partem do
--      MESMO arquivo, os números TÊM de bater — se baterem, a restauração no
--      projeto novo capturou tudo que o backup tinha. O projeto ANTIGO está
--      pausado e não dá para consultar direto; por isso a comparação é
--      contra a cópia local, não contra ele.
--
-- \set ON_ERROR_STOP off (explícito, e não só o padrão do psql): numa
-- restauração local, `cron`/`vault`/`net`/`pgsodium` costumam FALTAR (são
-- extensões do Postgres gerenciado da Supabase, não vêm no instalador
-- oficial do Windows) — sem isto, a PRIMEIRA linha que bater numa tabela
-- ausente para o arquivo inteiro e as contagens de negócio, que são as que
-- mais importam, nem chegam a rodar.
\set ON_ERROR_STOP off

\echo '=== produtos ==='
SELECT count(*) AS produtos FROM public.produtos;

\echo '=== variações de produto (product_variants) ==='
SELECT count(*) AS product_variants FROM public.product_variants;

\echo '=== pedidos (marketplace_orders) ==='
SELECT count(*) AS pedidos FROM public.marketplace_orders;

\echo '=== clientes (profiles) ==='
SELECT count(*) AS profiles FROM public.profiles;

\echo '=== auth.users ==='
SELECT count(*) AS auth_users FROM auth.users;

\echo '=== cupons (coupons) ==='
SELECT count(*) AS cupons FROM public.coupons;

\echo '=== Financeiro: contas (fin_contas) ==='
SELECT count(*) AS fin_contas FROM public.fin_contas;

\echo '=== Financeiro: lançamentos manuais (fin_lancamentos) ==='
SELECT count(*) AS fin_lancamentos FROM public.fin_lancamentos;

\echo '=== devoluções (devolucoes) ==='
SELECT count(*) AS devolucoes FROM public.devolucoes;

-- Faixa 72-83 (12 migrations, PR #666 + correções de risco): checagem
-- ABSOLUTA contra o repositório, não uma comparação com o projeto antigo —
-- version é o timestamp de 14 dígitos que nomeia o arquivo em
-- supabase/migrations/ (20261172000000 até 20261183000000). Esperado: 12.
\echo '=== ledger 72-83 (esperado: 12) ==='
SELECT count(*) AS ledger_72_83
  FROM supabase_migrations.schema_migrations
 WHERE version BETWEEN '20261172000000' AND '20261183999999';

-- Total do ledger — compare com o total de arquivos .sql em
-- supabase/migrations/ do SEU clone (o número muda a cada PR; em 28/09/2026
-- eram 195 — não confie neste comentário para o dia em que você rodar isto,
-- confira com (Get-ChildItem supabase\migrations\*.sql).Count no PowerShell,
-- dentro da pasta do repositório).
\echo '=== ledger, total (compare com o nº de arquivos em supabase/migrations/) ==='
SELECT count(*) AS ledger_total FROM supabase_migrations.schema_migrations;

-- pg_cron: as únicas 3 tarefas que o código agenda hoje (grep por
-- `cron.schedule` em supabase/migrations/). Se vier 0 linhas, é o sintoma
-- conhecido de dump lógico não recriar DADO de tabela de extensão (a
-- extensão pg_cron em si volta pelo schema, o AGENDAMENTO gravado em
-- cron.job pode não vir) — nesse caso rode os 3 `cron.schedule(...)` das
-- migrations 20260807000001, 20260808000100 e 20260901000000 à mão, uma vez
-- cada (são idempotentes: começam com `cron.unschedule` do mesmo nome).
\echo '=== jobs do pg_cron (esperado: 3 linhas — ver comentário acima) ==='
SELECT jobname, schedule, active
  FROM cron.job
 ORDER BY jobname;

-- Só para checar de olho que as extensões que o schema depende existem no
-- projeto novo (não é contagem de negócio, é presença). Se pg_cron/pg_net/
-- pgsodium/pg_graphql não aparecerem aqui, os passos (e)/(f) mais adiante
-- não vão funcionar mesmo com a restauração "certa" nos dados.
\echo '=== extensões instaladas ==='
SELECT extname FROM pg_extension ORDER BY extname;
