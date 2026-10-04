-- ============================================================================
-- Rollback manual — o ledger registra cada estorno do MP uma vez (20261192000000)
-- ============================================================================
-- Desfaz a 20261192000000: apaga os dois índices únicos parciais
-- (`public.uq_order_refunds_pedido_refund_mp` e
-- `public.uq_order_refunds_pedido_contestacao`). NENHUMA linha de
-- `order_refunds` é tocada. A coluna `mp_chargeback_id` FICA, de propósito:
-- apagá-la perderia a identidade das contestações já registradas (dado de
-- dinheiro) — se um dia for preciso, é decisão do dono, com o SQL mostrado.
--
-- Depois do rollback o defeito volta: duas entregas simultâneas do mesmo
-- estorno feito fora do app (ou da mesma contestação) podem gravar duas
-- linhas (somando em dobro em `valor_estornado`). As edges novas continuam
-- funcionando sem os índices (o 23505 só deixa de acontecer) — a coluna
-- continua lá para elas.
--
-- NO WINDOWS: rode `$env:PGCLIENTENCODING='UTF8'` no PowerShell ANTES do psql.
--
-- PRÉ-VOO: recusa com `B1_BASELINE_DIVERGENT` se um dos índices não existir
-- ou não tiver a definição desta migration — apagar por cima de uma redefinição
-- POSTERIOR apagaria a dela em silêncio. Mesma transação do restante.
--
-- Executar via `psql -1 -f` (nunca pelo db-apply, que registraria este
-- rollback no ledger de migrations como se fosse uma migration nova). Sem
-- BEGIN/COMMIT de nível superior neste arquivo — regra da casa.
-- ============================================================================

DO $preflight_rollback_20261192$
BEGIN
  IF to_regclass('public.uq_order_refunds_pedido_refund_mp') IS NULL
     OR pg_get_indexdef(to_regclass('public.uq_order_refunds_pedido_refund_mp'))
        IS DISTINCT FROM 'CREATE UNIQUE INDEX uq_order_refunds_pedido_refund_mp ON public.order_refunds USING btree (order_id, mp_refund_id) WHERE (mp_refund_id IS NOT NULL)' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.uq_order_refunds_pedido_refund_mp ausente ou não é o da 20261192000000 — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.';
  END IF;
  IF to_regclass('public.uq_order_refunds_pedido_contestacao') IS NULL
     OR pg_get_indexdef(to_regclass('public.uq_order_refunds_pedido_contestacao'))
        IS DISTINCT FROM 'CREATE UNIQUE INDEX uq_order_refunds_pedido_contestacao ON public.order_refunds USING btree (order_id, mp_chargeback_id) WHERE (mp_chargeback_id IS NOT NULL)' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.uq_order_refunds_pedido_contestacao ausente ou não é o da 20261192000000 — nada a desfazer, ou uma redefinição posterior está no ar; revise antes de reverter.';
  END IF;
END $preflight_rollback_20261192$;

DROP INDEX public.uq_order_refunds_pedido_refund_mp;
DROP INDEX public.uq_order_refunds_pedido_contestacao;
