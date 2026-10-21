-- A1/A3: estorno anterior à confirmação fecha a reserva numa transação;
-- pedido adiantado continua na reconciliação, NUNCA na expiração.
-- Últimos corpos: 2026110000100_concluir_estorno.sql e
-- 20261190000000_a_reconciliacao_alcanca_o_cartao_tardio.sql.
-- Assinaturas, SECURITY DEFINER, search_path e ACL preservados; sem BEGIN/COMMIT.
-- ROLLBACK (corpos anteriores copiados integralmente entre os delimitadores):
/* ROLLBACK_INICIO
CREATE OR REPLACE FUNCTION public.concluir_estorno(
    p_refund_id uuid,
    p_mp_refund_id text DEFAULT NULL,
    p_mp_status text DEFAULT NULL,
    p_mp_status_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_amount numeric(12,2);
    v_order_id uuid;
    v_valor_estornado numeric(12,2);
    v_payment_status text;
BEGIN
    -- Linha que nao existe e' erro de PROGRAMACAO (quem chama carregou a
    -- linha antes): falha alto, nao devolve "ja concluida" disfarcada.
    IF NOT EXISTS (SELECT 1 FROM public.order_refunds WHERE id = p_refund_id) THEN
        RAISE EXCEPTION 'Linha de devolução não encontrada: %.', p_refund_id;
    END IF;

    -- A conclusao da linha + o carimbo, SO' na primeira passagem (P13).
    -- COALESCE nos campos do MP: quem ja' gravou diagnostico melhor (a
    -- consulta do cron) nao e' sobrescrito por quem chegou depois.
    UPDATE public.order_refunds
       SET status = 'concluido',
           mp_refund_id = COALESCE(p_mp_refund_id, mp_refund_id),
           mp_status = COALESCE(p_mp_status, mp_status),
           mp_status_detail = COALESCE(p_mp_status_detail, mp_status_detail),
           concluido_em = now(),
           updated_at = now()
     WHERE id = p_refund_id
       AND (status <> 'concluido' OR concluido_em IS NULL)
    RETURNING amount, order_id INTO v_amount, v_order_id;

    IF v_order_id IS NULL THEN
        -- Ja' concluida antes (P13a): devolve o estado SEM somar de novo.
        -- E' o contrato que faz webhook/cron/edge poderem completar o mesmo
        -- estorno sem cuidado de coordenacao entre eles.
        SELECT o.valor_estornado, o.payment_status
          INTO v_valor_estornado, v_payment_status
          FROM public.marketplace_orders o
          JOIN public.order_refunds r ON r.order_id = o.id
         WHERE r.id = p_refund_id;
        RETURN jsonb_build_object(
            'concluido', true,
            'ja_concluida', true,
            'valor_estornado', v_valor_estornado,
            'payment_status', v_payment_status
        );
    END IF;

    -- A soma e' AQUI e so' aqui: valor_estornado so' anda com confirmacao
    -- do Mercado Pago (o chamador atestou). payment_status vira 'estornado'
    -- apenas quando o acumulado alcanca o total — parcial mantem o que era
    -- (o CASE le o valor ANTIGO da linha, regra do UPDATE do Postgres).
    -- A condicao valor_estornado + v_amount <= total e' a M3 do laudo do
    -- PR #439: a RPC e' o UNICO ponto por onde a soma passa (a Task 5 vai
    -- inserir linhas 'sistema' de estorno feito FORA do app) — o acumulado
    -- NUNCA passa do total do pedido.
    UPDATE public.marketplace_orders
       SET valor_estornado = valor_estornado + v_amount,
           payment_status = CASE
               WHEN valor_estornado + v_amount >= total THEN 'estornado'
               ELSE payment_status
           END,
           updated_at = now()
     WHERE id = v_order_id
       AND valor_estornado + v_amount <= total
    RETURNING valor_estornado, payment_status INTO v_valor_estornado, v_payment_status;

    IF v_valor_estornado IS NULL THEN
        -- Soma que passaria do total: RECUSA com erro nomeado (a Task 5
        -- decide o que fazer com estorno externo maior que o pago). A
        -- excecao desfaz tambem a conclusao da linha acima — mesma
        -- transacao, nada fica meio-concluido. Prova: P14b.
        RAISE EXCEPTION 'estorno_acima_do_total: a linha % somaria % e o acumulado passaria do total do pedido %.',
            p_refund_id, v_amount, v_order_id;
    END IF;

    RETURN jsonb_build_object(
        'concluido', true,
        'ja_concluida', false,
        'valor_estornado', v_valor_estornado,
        'payment_status', v_payment_status
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT o.id, o.gateway_payment_id
      FROM public.marketplace_orders o
      LEFT JOIN public.reconciliacao_visitas v ON v.order_id = o.id
     WHERE o.gateway_payment_id IS NOT NULL
       AND o.paid_at IS NULL
       -- 24 h para todo mundo (passado isso o PIX não é mais pagável); 14
       -- dias para o cartão possivelmente vivo — análise manual do MP pode
       -- aprovar dias depois (D2, revisor financeiro: N = 14).
       AND (
             o.expires_at > now() - interval '24 hours'
          OR (
               o.expires_at > now() - interval '14 days'
               AND COALESCE(
                     o.gateway_payment_id LIKE 'verificando:%'
                     OR o.metodo_online IN ('credito', 'debito'),
                     false
                   )
             )
       )
       -- Cobrança que o MP já deu como terminal sai da fila; cobrança NOVA na
       -- vaga (outro id) volta na hora.
       AND (v.cobranca_terminal IS NULL OR v.cobranca_terminal <> o.gateway_payment_id)
       AND (
             -- morto por expiracao (20260808000100)
             o.payment_status = 'expirado'
             -- morto por cancelamento com a cobranca viva (20260812000000)
          OR (o.payment_status = 'aguardando' AND o.status = 'cancelled')
             -- VIVO, e ainda da' para salvar (20261010000000)
          OR (o.payment_status = 'aguardando' AND o.status = 'pending')
       )
     -- Vivo primeiro; depois rodízio (nunca visitado / visitado há mais
     -- tempo); por fim o mais novo (D3: o LIMIT não monopoliza mais a fila).
     ORDER BY (o.status = 'pending') DESC, v.visitado_em ASC NULLS FIRST, o.expires_at DESC
     LIMIT 100;
$candidatos$;
ROLLBACK_FIM */

CREATE OR REPLACE FUNCTION public.concluir_estorno(
    p_refund_id uuid,
    p_mp_refund_id text DEFAULT NULL,
    p_mp_status text DEFAULT NULL,
    p_mp_status_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_amount numeric(12,2);
    v_order_id uuid;
    v_valor_estornado numeric(12,2);
    v_payment_status text;
    v_pedido record;
BEGIN
    -- Linha que nao existe e' erro de PROGRAMACAO (quem chama carregou a
    -- linha antes): falha alto, nao devolve "ja concluida" disfarcada.
    IF NOT EXISTS (SELECT 1 FROM public.order_refunds WHERE id = p_refund_id) THEN
        RAISE EXCEPTION 'Linha de devolução não encontrada: %.', p_refund_id;
    END IF;

    -- A conclusao da linha + o carimbo, SO' na primeira passagem (P13).
    -- COALESCE nos campos do MP: quem ja' gravou diagnostico melhor (a
    -- consulta do cron) nao e' sobrescrito por quem chegou depois.
    UPDATE public.order_refunds
       SET status = 'concluido',
           mp_refund_id = COALESCE(p_mp_refund_id, mp_refund_id),
           mp_status = COALESCE(p_mp_status, mp_status),
           mp_status_detail = COALESCE(p_mp_status_detail, mp_status_detail),
           concluido_em = now(),
           updated_at = now()
     WHERE id = p_refund_id
       AND (status <> 'concluido' OR concluido_em IS NULL)
    RETURNING amount, order_id INTO v_amount, v_order_id;

    IF v_order_id IS NULL THEN
        -- Ja' concluida antes (P13a): devolve o estado SEM somar de novo.
        -- E' o contrato que faz webhook/cron/edge poderem completar o mesmo
        -- estorno sem cuidado de coordenacao entre eles.
        SELECT o.valor_estornado, o.payment_status
          INTO v_valor_estornado, v_payment_status
          FROM public.marketplace_orders o
          JOIN public.order_refunds r ON r.order_id = o.id
         WHERE r.id = p_refund_id;
        RETURN jsonb_build_object(
            'concluido', true,
            'ja_concluida', true,
            'valor_estornado', v_valor_estornado,
            'payment_status', v_payment_status
        );
    END IF;

    -- Ordem global preservada: linha do refund (UPDATE acima), depois pedido.
    -- A fotografia sob a trava decide se ainda existe uma reserva nunca paga.
    SELECT status, payment_status, paid_at, stock_returned_at, cancelled_after_shipping
      INTO v_pedido
      FROM public.marketplace_orders
     WHERE id = v_order_id
     FOR UPDATE;

    -- A soma e' AQUI e so' aqui: valor_estornado so' anda com confirmacao
    -- do Mercado Pago (o chamador atestou). payment_status vira 'estornado'
    -- apenas quando o acumulado alcanca o total — parcial mantem o que era
    -- (o CASE le o valor ANTIGO da linha, regra do UPDATE do Postgres).
    -- A condicao valor_estornado + v_amount <= total e' a M3 do laudo do
    -- PR #439: a RPC e' o UNICO ponto por onde a soma passa (a Task 5 vai
    -- inserir linhas 'sistema' de estorno feito FORA do app) — o acumulado
    -- NUNCA passa do total do pedido.
    UPDATE public.marketplace_orders
       SET valor_estornado = valor_estornado + v_amount,
           payment_status = CASE
               WHEN valor_estornado + v_amount >= total THEN 'estornado'
               ELSE payment_status
           END,
           -- O MP confirmou dinheiro devolvido: houve entrada mesmo que o
           -- evento de aprovação não tenha chegado. Sem data de aprovação
           -- persistida, usa o instante desta conclusão do estorno.
           paid_at = CASE WHEN valor_estornado + v_amount >= total
                          THEN COALESCE(paid_at, now()) ELSE paid_at END,
           updated_at = now()
     WHERE id = v_order_id
       AND valor_estornado + v_amount <= total
    RETURNING valor_estornado, payment_status INTO v_valor_estornado, v_payment_status;

    IF v_valor_estornado IS NULL THEN
        -- Soma que passaria do total: RECUSA com erro nomeado (a Task 5
        -- decide o que fazer com estorno externo maior que o pago). A
        -- excecao desfaz tambem a conclusao da linha acima — mesma
        -- transacao, nada fica meio-concluido. Prova: P14b.
        RAISE EXCEPTION 'estorno_acima_do_total: a linha % somaria % e o acumulado passaria do total do pedido %.',
            p_refund_id, v_amount, v_order_id;
    END IF;

    -- Só a reserva pending NUNCA confirmada pode voltar automaticamente.
    -- Parcial, pedido já pago/adiantado ou com envio anterior não reestocam.
    -- devolver_estoque vigente já é idempotente por stock_returned_at.
    -- Mantém o carimbo explícito; tudo é desfeito junto se esta transação falhar.
    IF v_payment_status = 'estornado'
       AND v_pedido.paid_at IS NULL
       AND v_pedido.payment_status = 'aguardando'
       AND v_pedido.status = 'pending'
       AND NOT COALESCE(v_pedido.cancelled_after_shipping, false) THEN
        IF v_pedido.stock_returned_at IS NULL THEN
            PERFORM public.devolver_estoque(v_order_id);
            UPDATE public.marketplace_orders
               SET stock_returned_at = COALESCE(stock_returned_at, now())
             WHERE id = v_order_id;
        END IF;
        UPDATE public.marketplace_orders
           SET status = 'cancelled', updated_at = now()
         WHERE id = v_order_id;
    END IF;

    RETURN jsonb_build_object(
        'concluido', true,
        'ja_concluida', false,
        'valor_estornado', v_valor_estornado,
        'payment_status', v_payment_status
    );
END;
$$;

COMMENT ON FUNCTION public.concluir_estorno(uuid, text, text, text) IS
  'Fecha a devolucao confirmada pelo Mercado Pago: conclui order_refunds e soma valor_estornado na mesma transacao, sem ultrapassar o total. Integral vira estornado e preenche paid_at se ausente; parcial preserva pagamento e data. Estorno integral de pending nunca pago cancela, devolve estoque e grava paid_at. Exige pagamento aguardando e ausencia de envio anterior; pedido ja pago ou adiantado nao cancela nem reestoca. Idempotente: reentrega nao soma nem devolve estoque duas vezes. So servidor.';

REVOKE ALL ON FUNCTION public.concluir_estorno(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT o.id, o.gateway_payment_id
      FROM public.marketplace_orders o
      LEFT JOIN public.reconciliacao_visitas v ON v.order_id = o.id
     WHERE o.gateway_payment_id IS NOT NULL
       AND o.paid_at IS NULL
       -- 24 h para todo mundo (passado isso o PIX não é mais pagável); 14
       -- dias para o cartão possivelmente vivo — análise manual do MP pode
       -- aprovar dias depois (D2, revisor financeiro: N = 14).
       AND (
             o.expires_at > now() - interval '24 hours'
          OR (
               o.expires_at > now() - interval '14 days'
               AND COALESCE(
                     o.gateway_payment_id LIKE 'verificando:%'
                     OR o.metodo_online IN ('credito', 'debito'),
                     false
                   )
             )
       )
       -- Cobrança que o MP já deu como terminal sai da fila; cobrança NOVA na
       -- vaga (outro id) volta na hora.
       AND (v.cobranca_terminal IS NULL OR v.cobranca_terminal <> o.gateway_payment_id)
       AND (
             -- morto por expiracao (20260808000100)
             o.payment_status = 'expirado'
             -- morto por cancelamento com a cobranca viva (20260812000000)
          OR (o.payment_status = 'aguardando' AND o.status = 'cancelled')
             -- VIVO, e ainda da' para salvar (20261010000000)
          OR (o.payment_status = 'aguardando' AND o.status IN ('pending', 'processing', 'shipping'))
       )
     -- Vivo primeiro; depois rodízio (nunca visitado / visitado há mais
     -- tempo); por fim o mais novo (D3: o LIMIT não monopoliza mais a fila).
     ORDER BY (o.status IN ('pending', 'processing', 'shipping')) DESC, v.visitado_em ASC NULLS FIRST, o.expires_at DESC
     LIMIT 100;
$candidatos$;
