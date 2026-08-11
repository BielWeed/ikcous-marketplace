-- Desfazer MANUAL da 20260808000100_reconciliacao.sql.
--
-- POR QUE ESTE ARQUIVO EXISTE: o rollback que o db-apply.cjs gera para esta
-- migration sai VAZIO, e o proprio script avisa isso — ele so sabe restaurar
-- definicao anterior de funcao, e aqui a pagamentos_a_reconciliar e' funcao
-- NOVA (nao havia definicao anterior) e o cron.schedule nao e' funcao nenhuma.
-- Escrito ANTES de aplicar, em 10/08/2026, para ninguem ter de descobrir isto
-- no meio de um incidente. Backup e' diario e nao ha PITR.
--
-- SEM BEGIN/COMMIT: quem rodar isto pelo db-apply.cjs ja ganha a transacao. Se
-- for rodar direto no psql, abra a sua.

-- 1. O agendamento. E' o unico efeito desta migration que ACONTECE SOZINHO a
-- cada 10 minutos, entao e' o primeiro a sair.
SELECT cron.unschedule('reconciliar-pagamentos')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'reconciliar-pagamentos'
);

-- 2. A funcao de candidatos. Nao tem versao anterior para restaurar: ela
-- nasceu nesta migration.
DROP FUNCTION IF EXISTS public.pagamentos_a_reconciliar();

-- 3. O QUE ESTE ARQUIVO NAO FAZ, de proposito:
--
-- - NAO da DROP EXTENSION pg_net. A migration tem um `CREATE EXTENSION IF NOT
--   EXISTS pg_net` que foi NO-OP: o pg_net (0.19.5) ja estava instalado antes,
--   medido em 09/08/2026 e reconfirmado em 10/08/2026. Remove-lo desfaria algo
--   que esta migration nao fez.
--
-- - NAO apaga os segredos do Vault (reconciliacao_url, reconciliacao_secret).
--   Eles tambem foram criados FORA da migration, com vault.create_secret, e o
--   RECONCILIACAO_SECRET do ambiente das edge functions depende de bater com
--   eles. Apagar e' operacao deliberada e separada:
--
--     DELETE FROM vault.secrets
--      WHERE name IN ('reconciliacao_url', 'reconciliacao_secret');
--
-- - NAO desfaz a 20260810000000_confirmar_pagamento_guarda_status.sql, que e'
--   aplicada logo depois desta. Aquela redefine funcao existente, entao o
--   db-apply gera um rollback de verdade para ela — use aquele arquivo.
