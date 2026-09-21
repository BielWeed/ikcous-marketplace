-- ROLLBACK MANUAL da 20261152000000_varredura_libera_vaga_de_pedido_sem_cobranca.sql
-- (a varredura deixa de liberar a vaga do pedido nunca-cobrado; volta o
-- critério puro de expires_at + 24h)
--
-- ⚠️ NÃO RE-APLICAR A 20260970000000 INTEIRA para desfazer: aquele arquivo
-- também recria update_order_status_atomic e confirmar_retorno_do_produto
-- com os corpos DAQUELA ERA — reaplicá-los desfaria a 2026110000000 (o
-- estorno que nasce no ledger). O corpo anterior da varredura está EMBUTIDO
-- ABAIXO: rode este arquivo inteiro no SQL editor (CREATE OR REPLACE é
-- idempotente).
--
--   node scripts/db-apply.cjs \
--     supabase/migrations/rollback-manual-20261152000000_varredura_libera_vaga_de_pedido_sem_cobranca.sql
--
-- (o db-apply aplica em transação e regenera o rollback do rollback — que
-- é a própria 20261152000000 re-aplicada)
--
-- EFEITO COLATERAL HONESTO: o cupom de quem desistiu ANTES de gerar o PIX
-- volta a ficar preso por ~24,5h (GAP 1 reaberto para o sub-caso
-- nunca-cobrado); a frase canônica da 20261151000000 continua verdadeira
-- como teto ("em até 24 horas") — e a guarda de status na criar-pagamento
-- (porta B1 da peça 12) NÃO é desfazida por este arquivo: ela é
-- independente e continua de pé.

CREATE OR REPLACE FUNCTION public.devolver_cupons_de_pedidos_mortos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver_cupons_mortos$
DECLARE
    v_pedido     RECORD;
    v_devolvidos integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED: mesma protecao de expirar_pedidos_vencidos --
    -- se dois ciclos deste cron se sobrepuserem, ou se confirmar_pagamento
    -- estiver processando o MESMO pedido neste instante (por exemplo, um
    -- pagamento tardio que acabou de chegar), quem perder a corrida pela
    -- linha pula e tenta de novo no proximo ciclo -- nunca decrementa duas
    -- vezes, nunca decrementa um pedido que acabou de ser pago.
    --
    -- coupon_id IS NOT NULL: so' pedido com cupom entra na varredura.
    --
    -- status = 'cancelled' AND payment_status IS DISTINCT FROM 'pago' AND
    -- payment_status IS DISTINCT FROM 'pago_apos_expirar': exatamente o
    -- conjunto dos quatro pontos de desfazimento que ANTES desta migration
    -- devolviam (ou reconsumiam) o uso do cupom -- ver o cabecalho desta
    -- migration para a prova de que este WHERE reproduz aquele conjunto sem
    -- deduzir nada alem do que confirmar_pagamento ja registra.
    --
    -- coupon_usage_returned = FALSE: o FATO registrado, nunca deduzido --
    -- e' isto que torna a operacao idempotente por construcao. Pedido
    -- pre-existente (criado antes desta migration) nasce FALSE pelo
    -- DEFAULT da coluna, e entra na varredura normalmente -- correto,
    -- porque nenhuma versao anterior desta migration jamais rodou em
    -- producao.
    --
    -- expires_at IS NULL OR expires_at < now() - interval '24 hours': o
    -- numero da casa (pagamentos_a_reconciliar, 20260808000100), a decisao
    -- do Gabriel de que "a vaga fica reservada enquanto o PIX estiver
    -- aberto". expires_at IS NULL NAO e' so residuo historico -- e' o
    -- caminho CORRENTE de todo pedido "na entrega" criado por
    -- create_marketplace_order_v23 (a via PADRAO do app, useOrders.ts:
    -- 1059-1061; a v24 so' entra com pagamento online): v23 nunca grava
    -- expires_at nem payment_status, entao NULL aqui significa "nunca
    -- houve PIX por este caminho" -- sem janela nenhuma para proteger.
    --
    -- cancelled_after_shipping = false OR returned_to_seller_at IS NOT
    -- NULL: acrescentada por 20260970000000 -- pedido cancelado-apos-envio
    -- so' entra quando o lojista ja registrou o retorno
    -- (confirmar_retorno_do_produto). Vale para todos os ramos do WHERE.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE coupon_id IS NOT NULL
          AND status = 'cancelled'
          AND payment_status IS DISTINCT FROM 'pago'
          AND payment_status IS DISTINCT FROM 'pago_apos_expirar'
          AND coupon_usage_returned = FALSE
          AND (expires_at IS NULL OR expires_at < now() - interval '24 hours')
          AND (cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL)
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_uso_cupom(v_pedido.id);

        UPDATE public.marketplace_orders
           SET coupon_usage_returned = TRUE
         WHERE id = v_pedido.id;

        v_devolvidos := v_devolvidos + 1;
    END LOOP;

    RETURN v_devolvidos;
END;
$devolver_cupons_mortos$;

REVOKE ALL ON FUNCTION public.devolver_cupons_de_pedidos_mortos()
  FROM PUBLIC, anon, authenticated;
