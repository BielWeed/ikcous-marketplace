-- ============================================================================
-- Rollback manual — a loja muda de estado só pela porta (20261470000000)
-- ============================================================================
-- Tira o gatilho frota_lojas_estado_so_pela_porta de public.frota_lojas, a função dele e a porta public.frota_mudar_estado.
-- COM ELE VOLTA O COMPORTAMENTO DE ANTES: o estado de uma loja volta a mudar por UPDATE direto, sem trava das lojas que nunca dormem,
-- sem conferir a release e sem rastro. Reverter ANTES o comando scripts/frota/estado-da-loja.mjs (sem a porta, a chamada que ele imprime
-- falha com "function does not exist" e nada muda).
-- DADOS: public.frota_estado_historico (a tabela, a sequência e TODAS as linhas) FICA, fechada como estava; nenhuma linha de frota_lojas é
-- tocada (o estado de cada loja continua o que era). Reaplicar a migration volta a porta e o gatilho em cima do mesmo histórico. Apagar o
-- histórico é o rollback-manual-destrutivo-20261470000000 (só com o dono, depois deste). O rollback-manual-destrutivo-20261460000000 (que
-- tira as colunas de estado) só depois DESTE: o gatilho depende das colunas.
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a porta, a função do gatilho ou o gatilho existirem com outro corpo, outra assinatura,
-- sobrecarga ou o gatilho apontando para outra função (sucessora no ar?). Rodar de novo, já desfeito, é no-op. O pós-voo recusa se algum
-- dos três ficou.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação) ou, no banco da caderneta de produção, pela sessão
-- (MCP), numa transação. Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261470000000$
DECLARE
  v_lojas oid := to_regclass('public.frota_lojas');
  v_porta oid := to_regprocedure('public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)');
  v_gatilho_fn oid := to_regprocedure('public.frota_lojas_estado_so_pela_porta()');
BEGIN
  IF v_lojas IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.frota_lojas não existe — nada a reverter aqui; meça o banco.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('frota_mudar_estado', 'frota_lojas_estado_so_pela_porta'))
     <> (CASE WHEN v_porta IS NULL THEN 0 ELSE 1 END) + (CASE WHEN v_gatilho_fn IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: frota_mudar_estado ou frota_lojas_estado_so_pela_porta existe com outra assinatura ou com sobrecarga (sucessora no ar?); nada foi desfeito.';
  END IF;
  IF v_porta IS NOT NULL
     AND (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_porta) IS DISTINCT FROM 'd1dd1ae579be7a6f5c8687ea039cb3b8' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: frota_mudar_estado não tem o corpo da 20261470000000 (sucessora no ar?); nada foi desfeito.';
  END IF;
  IF v_gatilho_fn IS NOT NULL
     AND (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_gatilho_fn) IS DISTINCT FROM '58d85afbab0acb79eef70d03c304fb80' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: frota_lojas_estado_so_pela_porta não tem o corpo da 20261470000000 (sucessora no ar?); nada foi desfeito.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = v_lojas AND t.tgname = 'frota_lojas_estado_so_pela_porta' AND NOT t.tgisinternal
                AND t.tgfoid IS DISTINCT FROM v_gatilho_fn) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho frota_lojas_estado_so_pela_porta aponta para outra função; nada foi desfeito.';
  END IF;
END $preflight_rollback_20261470000000$;

DROP TRIGGER IF EXISTS frota_lojas_estado_so_pela_porta ON public.frota_lojas;
DROP FUNCTION IF EXISTS public.frota_lojas_estado_so_pela_porta();
DROP FUNCTION IF EXISTS public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz);

DO $posvoo_rollback_20261470000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('frota_mudar_estado', 'frota_lojas_estado_so_pela_porta'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.frota_lojas') AND t.tgname = 'frota_lojas_estado_so_pela_porta') THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261470000000: a porta, a função do gatilho ou o gatilho ainda existe';
  END IF;
END $posvoo_rollback_20261470000000$;

-- A porta saiu do catálogo: recarrega o schema cache do PostgREST. Idempotente.
NOTIFY pgrst, 'reload schema';
