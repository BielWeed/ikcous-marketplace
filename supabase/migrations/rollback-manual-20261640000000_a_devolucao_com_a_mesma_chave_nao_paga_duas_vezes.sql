-- ============================================================================
-- Rollback manual — a devolução com a mesma chave não paga duas vezes (20261640000000)
-- ============================================================================
-- Apaga a função `public.solicitar_estorno_com_chave(uuid, numeric, text, uuid)`: ela era NOVA na migration, então
-- desfazer é apagá-la; não há corpo anterior a restaurar (`solicitar_estorno` e as demais funções nunca foram tocadas).
--
-- MANTÉM a coluna `order_refunds.chave_da_solicitacao` e o índice `uq_order_refunds_chave_da_solicitacao`, com as chaves
-- já gravadas: sem a função ninguém escreve nem lê a coluna (ela fica parada), e reaplicar a migration volta ao mesmo
-- estado. Quem apaga a coluna e o índice é o
-- rollback-manual-destrutivo-20261640000000_a_devolucao_com_a_mesma_chave_nao_paga_duas_vezes.sql, só com o dono e só
-- depois deste.
--
-- COM ELE VOLTA O DEFEITO no front antigo (ele chama `solicitar_estorno`, sem chave). DESFAZER O FRONT ANTES: o front
-- novo chama a função e, sem ela, o botão "Devolver" falha com erro de função inexistente.
--
-- DADOS: nenhuma linha é lida ou escrita.
--
-- PRÉ-VOO: recusa antes de apagar se a função existir com corpo diferente do da migration (alguém a redefiniu: apagar
-- levaria junto uma redefinição que ninguém revisou) ou com sobrecarga. Estados aceitos: a função como desenhada (sai)
-- ou ausente (rodar de novo é no-op). Conferência final: a função não existe e a coluna, se existia, continua lá.
--
-- ORDEM: desfazer ESTA antes de desfazer a 20261197000000 (o rollback da 97 recusa enquanto alguma função cita
-- is_admin_atual) ou a 20261241000000 (a função chama pedido__saldo_a_estornar).
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transação). Sem BEGIN/COMMIT de nível
-- superior neste arquivo — regra da casa. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261640000000$
DECLARE
  v_oid oid := to_regprocedure('public.solicitar_estorno_com_chave(uuid,numeric,text,uuid)');
  v_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_com_chave') > 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: solicitar_estorno_com_chave tem sobrecarga em public — revise antes de apagar.';
  END IF;
  IF v_oid IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM '2021a69d46d49d227e4f1f206eb8df02' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.solicitar_estorno_com_chave(uuid,numeric,text,uuid) (hash %) não é o da 20261640000000 — uma redefinição posterior está no ar; revise antes de apagar.', COALESCE(v_hash, 'ausente');
    END IF;
  ELSIF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_com_chave') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: solicitar_estorno_com_chave existe em public com outra assinatura — revise antes de apagar.';
  END IF;
END $preflight_rollback_20261640000000$;

DROP FUNCTION IF EXISTS public.solicitar_estorno_com_chave(uuid, numeric, text, uuid);

DO $conferencia_rollback_20261640000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'solicitar_estorno_com_chave') THEN
    RAISE EXCEPTION 'conferencia rollback 20261640000000: a função ainda existe';
  END IF;
END $conferencia_rollback_20261640000000$;
