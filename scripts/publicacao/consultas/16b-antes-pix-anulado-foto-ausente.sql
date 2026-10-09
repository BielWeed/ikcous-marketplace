-- 16b — ANTES de aplicar as migrations 20261209000000 e 20261210000000 (o cupom preso
-- depois de "cancelou com o PIX gerado" volta em minutos, nao em 24 h): confirma que a foto
-- da cobranca NAO existe ainda (tabela, funcao do gatilho e gatilho ausentes), que as tres
-- funcoes que a 20261210000000 troca estao como as 20261205000000 e 20261206000000 as deixam
-- (o auxiliar de 9 parametros, a RPC e a varredura, com o corpo certo e UMA sobrecarga
-- cada) e que tudo de que os pre-voos das duas migrations dependem ESTA no banco. E' a
-- consulta de AUSENCIA do lote (`ausenciaConfirmadaPor` em scripts/frota/canais-de-backend.json):
-- so com a 16a NEGATIVA e esta POSITIVA (da mesma janela ou mais nova) o portao
-- (scripts/frota/publicar-release.mjs) imprime o apply dos DOIS arquivos.
-- SO LEITURA, um unico SELECT: catalogo (pg_proc, pg_namespace, pg_attribute, pg_trigger) e o
-- agendador (cron.job: so jobname, schedule e active). Nenhuma linha de pedido, cupom, foto da
-- cobranca, cliente ou dinheiro e' lida nem devolvida.
--
-- POR OBJETO, nunca por `schema_migrations`: o registro do ledger nao prova o que esta no
-- banco (o dono aplica a mao, o ledger pode estar vazio ou adiantado).
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. Rol FECHADO de 14
-- linhas, as mesmas em qualquer estado do banco (objeto ausente vira `AUSENTE` na propria
-- linha, nunca some uma linha). Tudo `true` = a loja esta na base de antes das migrations e
-- elas podem ser aplicadas; qualquer `false` = PARE e leia a linha (a migration, se aplicada
-- assim, abortaria no pre-voo `PREFLIGHT_20261209` ou `PREFLIGHT_20261210` -- aqui a gente
-- descobre ANTES, por leitura). Uma loja com a foto JA aplicada (inteira ou pela metade) ou
-- com a 20261210 aplicada reprova aqui de proposito: esta consulta e' "antes".
--
-- O QUE CADA LINHA PROVA (as mesmas condicoes dos pre-voos, mais a AUSENCIA do que a
-- 20261209000000 cria)
--   * controle         -- o papel enxerga as funcoes de `public` (catalogo vazio, por
--                         permissao, faria todo "AUSENTE" parecer prova de ausencia).
--   * colunas          -- as 12 colunas de `marketplace_orders` que o gatilho da foto e as tres
--                         funcoes leem existem (as seis que a 20261209000000 le, com o TIPO que
--                         o pre-voo dela confere: id uuid, status text, gateway_payment_id text,
--                         tentativas_de_pagamento integer, metodo_online text e payment_status
--                         text; as demais, so a existencia); a linha lista as que faltam.
--   * a foto ausente   -- a tabela `pedido_cobranca_ao_cancelar`, QUALQUER funcao de nome
--                         `pedido__foto_da_cobranca_ao_cancelar` (uma sobrecarga alheia tambem
--                         reprova) e o gatilho `tr_pedido_foto_da_cobranca_ao_cancelar` em
--                         `marketplace_orders` NAO existem. Meia migration (so a tabela, so o
--                         gatilho) reprova na linha do que ja existe.
--   * o auxiliar       -- `cupom__vaga_volta_em`: UMA sobrecarga, a de 9 parametros da
--                         20261206000000 (a de 13 parametros, da 20261210000000, ainda nao
--                         existe), com o sha256 do corpo da 20261206000000 (LF ou CRLF).
--   * a RPC            -- `vaga_do_cupom_presa`: UMA sobrecarga, com o sha256 do corpo da
--                         20261205000000 (LF ou CRLF).
--   * a varredura      -- `devolver_cupons_de_pedidos_mortos`: UMA sobrecarga, com o sha256 do
--                         corpo da 20261206000000 (LF ou CRLF). A 20261210000000 so troca o corpo
--                         que ela conhece: outro corpo (uma migration posterior, ou a 20261210
--                         ja aplicada) reprova aqui, antes de qualquer apply.
--   * dependencia      -- `devolver_uso_cupom(uuid)` existe (a varredura a chama).
--   * o agendamento    -- o job `devolver-cupons-de-pedidos-mortos` esta agendado a cada 15
--                         minutos e ATIVO (a varredura so devolve a vaga se ela roda).
--
-- VISIBILIDADE DO JOB (importante): `cron.job` tem RLS no pg_cron ("so quem criou o job
-- ve o job"), e um papel que SOFRE essa RLS pode ver ZERO jobs mesmo com o job rodando
-- (a mesma ressalva da 12a e da 8g-cron-reconciliar). Quem decide se o papel e' cego e'
-- row_security_active('cron.job'): `true` = a RLS vale para ele. A linha do agendamento so NAO
-- conclui nada quando as DUAS coisas valem: a RLS e' ativa para o papel E ele ve zero jobs;
-- ai ela diz `NAO VERIFICAVEL` nas duas colunas e fica ok = true so para nao travar o
-- portao por uma coisa que o papel nao enxerga (o job se confere no painel do Supabase,
-- Database -> Cron, ou pela 8g). Um papel que ATRAVESSA a RLS (BYPASSRLS, como o
-- supabase_read_only_user) tem `false` e a linha e' ESTRITA mesmo com zero jobs: job
-- ausente reprova. Tambem e' estrita quando o papel ve algum job: ausente, inativo ou com
-- outro horario reprova. Se o papel nao tem sequer USAGE no schema cron, a consulta ERRA
-- (SQLSTATE 42501) e o portao fica SEM EVIDENCIA, nunca positivo.
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), a mesma conta dos pre-voos.
-- Cada hash aparece aqui uma vez em LF e uma em CRLF; tests/ci_conferir_banco_test.ts os
-- recalcula dos ARQUIVOS das migrations 20261205 e 20261206 desta arvore e confere que sao os
-- mesmos que o pre-voo da 20261210000000 aceita, e
-- tests/banco/cupom-pix-anulado-portao-viva.cjs roda esta consulta num Postgres real
-- (positiva antes do apply, e um negativo por linha).
--
-- LIMITES: nao prova o COMPORTAMENTO (isso e' a prova viva das migrations, em
-- tests/banco/cupom-pix-anulado-viva.cjs). Nao le dado nenhum: nao diz se ha pedido com cupom,
-- pedido cancelado ou foto. Evidencia LOCAL nao prova a IKCOUS nem a Savy: so o run desta
-- consulta contra o ref de cada loja.
WITH tab AS (
  SELECT to_regclass('public.marketplace_orders') AS pedidos
), faltam AS (
  SELECT split_part(v.item, ':', 1) AS coluna
    FROM unnest(ARRAY[
           'id:uuid', 'status:text', 'gateway_payment_id:text',
           'tentativas_de_pagamento:integer', 'metodo_online:text', 'payment_status:text',
           'user_id:', 'coupon_id:', 'coupon_usage_returned:', 'expires_at:',
           'cancelled_after_shipping:', 'returned_to_seller_at:'
         ]) AS v(item)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = (SELECT t.pedidos FROM tab t)
              AND a.attname = split_part(v.item, ':', 1)
              AND a.attnum > 0 AND NOT a.attisdropped
              AND (split_part(v.item, ':', 2) = ''
                   OR format_type(a.atttypid, a.atttypmod) = split_part(v.item, ':', 2)))
), alvo(chave, assinatura) AS (
  VALUES ('aux', 'public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer)'),
         ('rpc', 'public.vaga_do_cupom_presa(text)'),
         ('var', 'public.devolver_cupons_de_pedidos_mortos()')
), fn AS (
  SELECT t.chave,
         encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h
    FROM alvo t
    JOIN pg_proc p ON p.oid = to_regprocedure(t.assinatura)
), vis AS (
  SELECT count(*) AS n FROM cron.job
), rls AS (
  SELECT row_security_active('cron.job') AS ativa
), agendado AS (
  SELECT j.schedule, j.active
    FROM cron.job j
   WHERE j.jobname = 'devolver-cupons-de-pedidos-mortos'
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'marketplace_orders: colunas que o gatilho e as funcoes leem', 'EXISTEM',
         CASE WHEN (SELECT pedidos FROM tab) IS NULL THEN 'AUSENTE: a tabela marketplace_orders'
              ELSE COALESCE((SELECT 'AUSENTES (ou em outro tipo): ' || string_agg(f.coluna, ', ' ORDER BY f.coluna)
                               FROM faltam f), 'EXISTEM') END
  UNION ALL
  SELECT 'pedido_cobranca_ao_cancelar: tabela', 'AUSENTE',
         CASE WHEN to_regclass('public.pedido_cobranca_ao_cancelar') IS NOT NULL THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'pedido__foto_da_cobranca_ao_cancelar: funcao', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE n.nspname = 'public' AND p.proname = 'pedido__foto_da_cobranca_ao_cancelar')
              THEN 'PRESENTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'gatilho tr_pedido_foto_da_cobranca_ao_cancelar: ausente em marketplace_orders', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t
                            WHERE t.tgrelid = (SELECT pedidos FROM tab)
                              AND t.tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar')
              THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'cupom__vaga_volta_em: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'cupom__vaga_volta_em')
  UNION ALL
  SELECT 'cupom__vaga_volta_em: assinatura', 'so a de 9 parametros',
         CASE WHEN to_regprocedure('public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer,text,integer,text,text)') IS NOT NULL
              THEN 'a de 13 parametros ja existe'
              WHEN to_regprocedure('public.cupom__vaga_volta_em(uuid,text,text,boolean,timestamptz,boolean,timestamptz,text,integer)') IS NULL
              THEN 'AUSENTE'
              ELSE 'so a de 9 parametros' END
  UNION ALL
  SELECT 'cupom__vaga_volta_em: corpo e o da 20261206000000 (sha256)',
         'aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363',
         COALESCE((SELECT CASE WHEN f.h IN ('aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363',
                                            '6fc3bb6775c34d5739516fa9841bbc4787ae2d3be87e647acca8d465c513f6b6')
                               THEN 'aa8f0ef494f54dc952ed9f8fd7e95997a988086c278bfd0ebbdf0117f68c2363'
                               ELSE f.h END
                     FROM fn f WHERE f.chave = 'aux'), 'AUSENTE')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'vaga_do_cupom_presa')
  UNION ALL
  SELECT 'vaga_do_cupom_presa: corpo e o da 20261205000000 (sha256)',
         'a7db9046f7dbb296c0d92ada3b097ef79c68d3e76a76df2c9542ec11b2d76b47',
         COALESCE((SELECT CASE WHEN f.h IN ('a7db9046f7dbb296c0d92ada3b097ef79c68d3e76a76df2c9542ec11b2d76b47',
                                            '49e0b6befb684756ed4f1fada1e30ed7162763dc903816f49f2f76ce61820593')
                               THEN 'a7db9046f7dbb296c0d92ada3b097ef79c68d3e76a76df2c9542ec11b2d76b47'
                               ELSE f.h END
                     FROM fn f WHERE f.chave = 'rpc'), 'AUSENTE')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'devolver_cupons_de_pedidos_mortos')
  UNION ALL
  SELECT 'devolver_cupons_de_pedidos_mortos: corpo e o da 20261206000000 (sha256)',
         'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f',
         COALESCE((SELECT CASE WHEN f.h IN ('f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f',
                                            'c7e38a04defe6b286519f2325c6d4d8ec727f57c4b0edbb5bc5831d936fbe9b8')
                               THEN 'f35db1e788fb8e0472dd6b8318c69be524c3f932d62c5f7b2856fe97d243eb4f'
                               ELSE f.h END
                     FROM fn f WHERE f.chave = 'var'), 'AUSENTE')
  UNION ALL
  SELECT 'dependencia devolver_uso_cupom(uuid): existe', 'EXISTE',
         CASE WHEN to_regprocedure('public.devolver_uso_cupom(uuid)') IS NOT NULL THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'job devolver-cupons-de-pedidos-mortos: agendado a cada 15 min e ativo',
         CASE WHEN (SELECT n FROM vis) = 0 AND (SELECT ativa FROM rls)
              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'
              ELSE 'ativo */15 * * * *' END,
         CASE WHEN (SELECT n FROM vis) = 0 AND (SELECT ativa FROM rls)
              THEN 'NAO VERIFICAVEL: este papel nao ve nenhum job do cron'
              WHEN NOT EXISTS (SELECT 1 FROM agendado) THEN 'AUSENTE'
              ELSE (SELECT string_agg(CASE WHEN g.active THEN 'ativo ' ELSE 'inativo ' END || g.schedule,
                                      '; ' ORDER BY g.schedule, g.active)
                      FROM agendado g) END
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
