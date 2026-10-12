-- 10b — ANTES de aplicar a migration 20261203000000 (cupons desligados pela loja
-- nao dao desconto, issue #645) numa loja: o gatilho que ela cria AINDA NAO existe e
-- o corpo vivo de `validate_coupon_secure_v2(text, numeric)` e' exatamente o
-- baseline que o pre-voo da propria migration exige. E' a consulta de AUSENCIA do
-- lote `20261203000000` em scripts/frota/canais-de-backend.json
-- (`ausenciaConfirmadaPor`): so com ela POSITIVA, depois de uma 10a NEGATIVA, o
-- portao imprime o comando de apply.
-- SO LEITURA, um unico SELECT, so catalogo (pg_trigger, pg_proc, pg_attribute):
-- nenhuma linha de pedido, cupom ou cliente e' lida nem devolvida.
--
-- POR OBJETO, nunca por `schema_migrations`: o registro do ledger nao prova o que
-- esta no banco (o dono aplica a mao, o ledger pode estar vazio ou adiantado).
--
-- Saida: item | esperado | vivo | ok, com as linhas ok = false primeiro. O rol e'
-- FECHADO: sempre as mesmas 6 linhas, em qualquer estado do banco. Tudo `true` =
-- a loja esta na base de antes da migration e ela pode ser aplicada; qualquer
-- `false` = PARE e leia a linha (a migration, se aplicada assim, abortaria no
-- pre-voo `B1_BASELINE_DIVERGENT` -- aqui a gente descobre ANTES, por leitura).
--
-- O QUE CADA LINHA PROVA (as mesmas condicoes do pre-voo da migration)
--   * controle     -- o papel enxerga as funcoes de `public` (catalogo vazio, por
--                     permissao, faria todo "AUSENTE" parecer prova de ausencia).
--   * colunas      -- `marketplace_orders.coupon_id` e `store_config.enable_coupons`
--                     existem (o gatilho e o bloco novo da validacao leem as duas).
--   * gatilho      -- `tr_pedido_com_cupom_exige_a_chave_ligada` AUSENTE em
--                     `public.marketplace_orders` (qualquer estado dele, inclusive
--                     desabilitado, conta como presente).
--   * validate     -- exatamente UMA sobrecarga de `validate_coupon_secure_v2` em
--                     `public`, e o corpo (prosrc) dela tem o sha256 do baseline
--                     20260806000000, em LF ou CRLF, que o pre-voo aceita. O corpo
--                     NOVO (o de depois da migration) reprova AQUI de proposito:
--                     esta consulta e' "antes".
--
-- sha256 = encode(sha256(convert_to(prosrc, 'UTF8')), 'hex'), a mesma conta do
-- pre-voo da migration. tests/ci_conferir_banco_test.ts confere os dois hashes
-- contra o literal do pre-voo da migration desta arvore;
-- tests/banco/cupons-desligados-portao-viva.cjs roda esta consulta num Postgres
-- real (positiva num banco montado SEM a migration, negativa depois dela).
--
-- LIMITES: evidencia LOCAL nao prova a CAF nem a Savy: so o run desta consulta
-- contra o ref de cada loja.
WITH tab AS (
  SELECT to_regclass('public.marketplace_orders') AS oid
), va AS (
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS h
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.validate_coupon_secure_v2(text,numeric)')
), itens(item, esperado, vivo) AS (
  SELECT 'controle: funcoes de public visiveis a este papel', '>0',
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public') > 0 THEN '>0' ELSE '0' END
  UNION ALL
  SELECT 'coluna marketplace_orders.coupon_id: existe', 'EXISTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a JOIN tab ON a.attrelid = tab.oid
                            WHERE a.attname = 'coupon_id' AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'coluna store_config.enable_coupons: existe', 'EXISTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                            WHERE a.attrelid = to_regclass('public.store_config')
                              AND a.attname = 'enable_coupons' AND a.attnum > 0 AND NOT a.attisdropped)
              THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'gatilho tr_pedido_com_cupom_exige_a_chave_ligada: ausente em marketplace_orders', 'AUSENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger t JOIN tab ON t.tgrelid = tab.oid
                            WHERE t.tgname = 'tr_pedido_com_cupom_exige_a_chave_ligada')
              THEN 'EXISTE' ELSE 'AUSENTE' END
  UNION ALL
  SELECT 'validate_coupon_secure_v2: sobrecargas', '1',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'validate_coupon_secure_v2')
  UNION ALL
  SELECT 'validate_coupon_secure_v2: corpo e o baseline (sha256)',
         '5fefbbe6648d44e9f6837b2a6f24d8a5223060f55b8a67fa68c223a15ab742d7',
         COALESCE((SELECT CASE WHEN v.h IN ('5fefbbe6648d44e9f6837b2a6f24d8a5223060f55b8a67fa68c223a15ab742d7',
                                            'b325866f6648a0f97d13d894c823a89e1ff2a6682d49db3d25816cef358eaddc')
                               THEN '5fefbbe6648d44e9f6837b2a6f24d8a5223060f55b8a67fa68c223a15ab742d7'
                               ELSE v.h END
                     FROM va v), 'AUSENTE')
)
SELECT item, esperado, vivo, COALESCE(vivo = esperado, false) AS ok
  FROM itens
 ORDER BY ok, item;
