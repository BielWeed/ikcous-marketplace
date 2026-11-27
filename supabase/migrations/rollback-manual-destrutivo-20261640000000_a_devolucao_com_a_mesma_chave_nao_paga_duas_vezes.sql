-- ROLLBACK DESTRUTIVO 20261640000000 - SO COM O DONO.
-- Apaga o indice public.uq_order_refunds_chave_da_solicitacao e a coluna public.order_refunds.chave_da_solicitacao (a chave
-- da intencao de cada devolucao pedida pelo painel novo). O rollback comum PRESERVA os dois. Depois de apagar, as chaves NAO
-- tem como ser recuperadas daqui: se a migration for reaplicada, uma retentativa de uma intencao de ANTES do apagamento
-- (com a chave antiga, ainda guardada no aparelho da lojista por ate 30 min) cria uma linha nova em vez de devolver a que ja
-- existia. Nenhuma outra coluna, linha ou objeto e' tocado; nenhuma linha de order_refunds e' apagada.
-- So depois do rollback comum (rollback-manual-20261640000000_a_devolucao_com_a_mesma_chave_nao_paga_duas_vezes.sql), numa
-- transacao do caller, com confirmacao explicita (SET LOCAL vale so ate o fim da transacao; um SET sem LOCAL ficaria na
-- sessao inteira e confirmaria o apagamento de uma chamada futura que ninguem pediu):
--   SET LOCAL app.confirmo_apagar_chave_da_solicitacao = 'APAGAR';
-- PRE-VOO: recusa sem apagar nada se faltar a confirmacao; se a funcao da migration ainda existir
-- (CHAVE_DA_SOLICITACAO_ROLLBACK_COMUM_PRIMEIRO); se a coluna existir com outra forma ou o indice com outra definicao; ou se
-- QUALQUER funcao fora dos esquemas do sistema ainda citar chave_da_solicitacao no corpo (o plpgsql nao registra
-- dependencia: apagar quebraria essa funcao em silencio). Uma visao que dependa da coluna faz o proprio Postgres recusar
-- (sem CASCADE).
-- Idempotente: DROP INDEX IF EXISTS e DROP COLUMN IF EXISTS; rodar duas vezes nao erra. Sem BEGIN/COMMIT: quem roda abre a
-- transacao.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261640000000$
DECLARE
  v_coluna text;
  v_funcoes text;
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_chave_da_solicitacao', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'CHAVE_DA_SOLICITACAO_SO_COM_O_DONO: confirme antes de apagar a coluna chave_da_solicitacao (SET LOCAL app.confirmo_apagar_chave_da_solicitacao = ''APAGAR'').';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname = 'solicitar_estorno_com_chave') THEN
    RAISE EXCEPTION 'CHAVE_DA_SOLICITACAO_ROLLBACK_COMUM_PRIMEIRO: a funcao solicitar_estorno_com_chave ainda existe - rode o rollback comum antes de apagar a coluna.';
  END IF;
  SELECT format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || a.atthasdef::text INTO v_coluna
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.order_refunds') AND a.attname = 'chave_da_solicitacao' AND NOT a.attisdropped;
  IF v_coluna IS NOT NULL AND v_coluna <> 'uuid:false:false' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: order_refunds.chave_da_solicitacao existe com outra forma (%) - nao e a coluna desta migration; revise antes de apagar.', v_coluna;
  END IF;
  IF to_regclass('public.uq_order_refunds_chave_da_solicitacao') IS NOT NULL
     AND pg_get_indexdef(to_regclass('public.uq_order_refunds_chave_da_solicitacao'))
         IS DISTINCT FROM 'CREATE UNIQUE INDEX uq_order_refunds_chave_da_solicitacao ON public.order_refunds USING btree (chave_da_solicitacao) WHERE (chave_da_solicitacao IS NOT NULL)' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.uq_order_refunds_chave_da_solicitacao existe com outra definicao - nao e o indice desta migration; revise antes de apagar.';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_funcoes
    FROM pg_proc p
   WHERE p.pronamespace NOT IN ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
     AND p.prosrc LIKE '%chave_da_solicitacao%';
  IF v_funcoes IS NOT NULL THEN
    RAISE EXCEPTION 'CHAVE_DA_SOLICITACAO_AINDA_CITADA: % ainda cita chave_da_solicitacao - apagar a coluna quebraria a funcao em silencio; revise antes.', v_funcoes;
  END IF;
END $destrutivo_20261640000000$;

DROP INDEX IF EXISTS public.uq_order_refunds_chave_da_solicitacao;

ALTER TABLE public.order_refunds DROP COLUMN IF EXISTS chave_da_solicitacao;

DO $conferencia_destrutivo_20261640000000$
BEGIN
  IF to_regclass('public.uq_order_refunds_chave_da_solicitacao') IS NOT NULL THEN
    RAISE EXCEPTION 'conferencia destrutivo 20261640000000: o indice ainda existe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = to_regclass('public.order_refunds') AND a.attname = 'chave_da_solicitacao' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'conferencia destrutivo 20261640000000: a coluna ainda existe';
  END IF;
END $conferencia_destrutivo_20261640000000$;
