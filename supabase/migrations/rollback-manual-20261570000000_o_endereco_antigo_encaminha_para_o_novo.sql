-- ============================================================================
-- Rollback manual — o endereço antigo encaminha para o novo (20261570000000)
-- ============================================================================
-- Tira a porta de leitura public.resolver_encaminhamento. COM ELE O PORTEIRO VOLTA A DAR "NÃO ACHEI" para todo endereço que encaminha
-- (a chamada à porta ausente responde "função não existe", que o porteiro trata como "não achei"): o endereço antigo de uma loja que
-- trocou de domínio volta a mostrar "loja em manutenção". O endereço principal de cada loja não muda em nada (a v2 não é tocada).
-- DADOS: public.frota_enderecos_que_encaminham (a tabela, o gatilho, a função do gatilho e TODAS as linhas) FICA, fechada como estava;
-- nenhuma linha de frota_lojas é tocada. Reaplicar a migration devolve a porta em cima dos mesmos endereços. Apagar a tabela é o
-- rollback-manual-destrutivo-20261570000000 (só com o dono, depois deste).
--
-- PRÉ-VOO: recusa (B1_BASELINE_DIVERGENT) se a porta existir com outro corpo, outra assinatura ou sobrecarga (sucessora no ar?). Rodar
-- de novo, já desfeito, é no-op. O pós-voo recusa se a porta ficou.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação) ou, no banco da caderneta de produção, pela sessão
-- (MCP), numa transação. Sem BEGIN/COMMIT de nível superior neste arquivo.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261570000000$
DECLARE
  v_leitura oid := to_regprocedure('public.resolver_encaminhamento(text, text)');
BEGIN
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_encaminhamento')
     <> (CASE WHEN v_leitura IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_encaminhamento existe com outra assinatura ou com sobrecarga (sucessora no ar?); nada foi desfeito.';
  END IF;
  IF v_leitura IS NOT NULL
     AND (SELECT md5(replace(p.prosrc, E'\r', '')) FROM pg_proc p WHERE p.oid = v_leitura) IS DISTINCT FROM '5ca45d858b56991facb8d2052f0aecfb' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: resolver_encaminhamento não tem o corpo da 20261570000000 (sucessora no ar?); nada foi desfeito.';
  END IF;
END $preflight_rollback_20261570000000$;

DROP FUNCTION IF EXISTS public.resolver_encaminhamento(text, text);

DO $posvoo_rollback_20261570000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'resolver_encaminhamento') THEN
    RAISE EXCEPTION 'POSVOO_ROLLBACK_20261570000000: a porta resolver_encaminhamento ainda existe';
  END IF;
END $posvoo_rollback_20261570000000$;

-- A porta saiu do catálogo: recarrega o schema cache do PostgREST. Idempotente.
NOTIFY pgrst, 'reload schema';
