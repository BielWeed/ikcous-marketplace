-- 12b — ANTES de aplicar as migrations 20261205000000 e 20261206000000 (o cupom
-- preso diz quando a vaga volta, e a vaga do pedido nunca cobrado volta em 1 h):
-- confirma que as duas funcoes novas AINDA NAO existem, que a varredura
-- `devolver_cupons_de_pedidos_mortos()` esta com o corpo da 20260970000000 e que
-- tudo de que os pre-voos das duas migrations dependem ESTA no banco. E' a consulta
-- de AUSENCIA do lote (`ausenciaConfirmadaPor` em scripts/frota/canais-de-backend.json):
-- so com a 12a NEGATIVA e esta POSITIVA (da mesma janela ou mais nova) o portao
-- (scripts/frota/publicar-release.mjs) imprime o apply dos DOIS arquivos.
-- SO LEITURA, um unico SELECT: catalogo (pg_proc, pg_namespace, pg_attribute) e o
-- agendador (cron.job: so jobname, schedule e active). Nenhuma linha de pedido,
-- cupom, cliente ou dinheiro e' lida nem devolvida.
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO
-- de 10 linhas, as mesmas em qualquer estado do banco.
--
-- O QUE CADA LINHA PROVA (as mesmas condicoes dos pre-voos `PREFLIGHT_20261205` e
-- `PREFLIGHT_20261206` das migrations)
--   * auxiliar e RPC ausentes -- zero sobrecargas de `cupom__vaga_volta_em` e de
--                         `vaga_do_cupom_presa` (ja existindo, a migration so reaplica
--                         se o corpo for o dela; aqui a ausencia e' a premissa de
--                         "ainda nao aplicado").
--   * a varredura      -- UMA sobrecarga, com o corpo da 20260970000000 (sha256, LF ou
--                         CRLF): o auxiliar so espelha ESSE corpo, e a 20261206 so
--                         reescreve a partir dele. Um corpo de outra migration
--                         posterior reprova aqui, antes de qualquer apply.
--   * dependencias     -- `devolver_uso_cupom(uuid)` e `auth.uid()` existem; as
--                         tabelas `marketplace_orders` e `coupons` e as colunas que o
--                         auxiliar, a RPC e a varredura leem existem.
--   * o agendamento    -- o job `devolver-cupons-de-pedidos-mortos` esta agendado a
--                         cada 15 minutos e ATIVO (a varredura so devolve a vaga se ela
--                         roda).
--
-- VISIBILIDADE DO JOB (importante): `cron.job` tem RLS no pg_cron ("so quem criou o job
-- ve o job"), e o papel so-leitura do portao pode ver ZERO jobs mesmo com o job
-- rodando (a mesma ressalva da 8g-cron-reconciliar). Quando este papel nao ve NENHUM
-- job, a linha do agendamento NAO conclui nada: ela diz `NAO VERIFICAVEL` nas duas
-- colunas (esperado e vivo), com o nome do motivo, e fica ok = true so para nao
-- travar o portao por uma coisa que o papel nao enxerga. Nesse caso o job se confere
-- no painel do Supabase (Database -> Cron) ou pela 8g. Quando o papel ve algum job, a
-- linha e' estrita: job ausente, inativo ou com outro horario reprova. Se o papel nao
-- tem sequer USAGE no schema cron, a consulta ERRA (SQLSTATE 42501) e o portao fica
-- SEM EVIDENCIA, nunca positivo.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), a mesma conta dos
-- pre-voos. O hash do corpo da varredura aparece uma vez em LF e uma em CRLF;
-- tests/ci_conferir_banco_test.ts os compara com os dos pre-voos das migrations, e
-- tests/banco/cupom-preso-portao-viva.cjs roda esta consulta num Postgres real
-- (positivo antes do apply, e um negativo por linha).
--
-- LIMITES: nao prova o COMPORTAMENTO (isso e' a prova viva das migrations, em
-- tests/banco/cupom-preso-viva.cjs). Evidencia LOCAL nao prova a CAF nem a Savy: so o
-- run desta consulta contra o ref de cada loja.
WITH tabelas AS (
  SELECT t.nome, to_regclass('public.' || t.nome) AS oid
    FROM (VALUES ('marketplace_orders'), ('coupons')) AS t(nome)
), colunas AS (
  SELECT c.tabela, c.coluna,
         EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = to_regclass('public.' || c.tabela)
                    AND a.attname = c.coluna AND a.attnum > 0 AND NOT a.attisdropped) AS existe
    FROM (VALUES ('marketplace_orders', 'id'), ('marketplace_orders', 'user_id'),
                 ('marketplace_orders', 'coupon_id'), ('marketplace_orders', 'status'),
                 ('marketplace_orders', 'payment_status'),
                 ('marketplace_orders', 'coupon_usage_returned'),
                 ('marketplace_orders', 'expires_at'),
                 ('marketplace_orders', 'cancelled_after_shipping'),
                 ('marketplace_orders', 'returned_to_seller_at'),
                 ('marketplace_orders', 'gateway_payment_id'),
                 ('marketplace_orders', 'tentativas_de_pagamento'),
                 ('coupons', 'id'), ('coupons', 'code'), ('coupons', 'active'),
                 ('coupons', 'usage_count'), ('coupons', 'usage_limit')) AS c(tabela, coluna)
), varredura AS (
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.devolver_cupons_de_pedidos_mortos()')
), vis AS (
  SELECT count(*) AS n FROM cron.job
), agendado AS (
  SELECT j.schedule, j.active
    FROM cron.job j
   WHERE j.jobname = 'devolver-cupons-de-pedidos-mortos'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'cupom__vaga_volta_em: ausente', '0',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'cupom__vaga_volta_em')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: ausente', '0',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'vaga_do_cupom_presa')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'devolver_cupons_de_pedidos_mortos')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: corpo e o da 20260970 (sha256)',
         '85a340abad3fb3f3cd913f50126bc610f584076295bbb61a8203fabcbd6c0633',
         COALESCE((SELECT CASE WHEN v.h IN ('85a340abad3fb3f3cd913f50126bc610f584076295bbb61a8203fabcbd6c0633',
                                            'd0b285fdb3d939243e4399e69e04bbd1bead56ab231079199cac2ed56b3ea0ae')
                               THEN '85a340abad3fb3f3cd913f50126bc610f584076295bbb61a8203fabcbd6c0633'
                               ELSE v.h END
                     FROM varredura v), 'AUSENTE')
  UNION ALL
  SELECT 'dependencia devolver_uso_cupom(uuid): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.devolver_uso_cupom(uuid)') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'dependencia auth.uid(): existe', 'EXISTE',
         CASE WHEN to_regprocedure('auth.uid()') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'tabelas usadas: existem', 'TODAS',
         CASE WHEN (SELECT bool_and(t.oid IS NOT NULL) FROM tabelas t) THEN 'TODAS'
              ELSE 'FALTA: ' || (SELECT string_agg(t.nome, ',' ORDER BY t.nome) FROM tabelas t WHERE t.oid IS NULL) END
  UNION ALL
  SELECT 'colunas usadas: existem', 'TODAS',
         CASE WHEN (SELECT bool_and(c.existe) FROM colunas c) THEN 'TODAS'
              ELSE 'FALTA: ' || (SELECT string_agg(c.tabela || '.' || c.coluna, ',' ORDER BY c.tabela, c.coluna)
                                   FROM colunas c WHERE NOT c.existe) END
  UNION ALL
  SELECT 'job devolver-cupons-de-pedidos-mortos: agendado a cada 15 min e ativo',
         CASE WHEN (SELECT n FROM vis) = 0
              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'
              ELSE 'ativo */15 * * * *' END,
         CASE WHEN (SELECT n FROM vis) = 0
              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'
              WHEN NOT EXISTS (SELECT 1 FROM agendado) THEN 'AUSENTE'
              ELSE (SELECT string_agg(CASE WHEN g.active THEN 'ativo ' ELSE 'inativo ' END || g.schedule,
                                      '; ' ORDER BY g.schedule, g.active)
                      FROM agendado g) END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
