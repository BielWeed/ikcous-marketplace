-- Fase 3 da cobranca: a RPC que confirma pagamento sob trava.
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

-- 1. Carimbo de quando o dinheiro entrou -------------------------------
-- Sem ele, "quando entrou" so existe no Mercado Pago, e a fila de atencao do
-- admin nao tem como ordenar nem a reconciliacao como medir atraso.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- 2. A decisao sob trava ------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_pagamento(
    p_order_id   uuid,
    p_payment_id text,
    p_status     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $confirmar$
DECLARE
    v_pedido RECORD;
BEGIN
    -- FOR UPDATE sem SKIP LOCKED: se a expirar_pedidos_vencidos esta com a
    -- linha, ESPERAR e' o comportamento correto. Pular deixaria o pagamento
    -- sem registro. Depois da espera, o payment_status lido aqui embaixo ja
    -- e' o que a varredura gravou — e' a releitura que decide, nao o WHERE.
    SELECT id, payment_status, gateway_payment_id
      INTO v_pedido
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'inexistente';
    END IF;

    -- O pedido guarda o id da cobranca desde a criacao (Fase 2). Se o que
    -- chegou nao bate, alguem esta confirmando o pagamento de OUTRO pedido:
    -- nao escrever e deixar para uma pessoa olhar.
    IF v_pedido.gateway_payment_id IS DISTINCT FROM p_payment_id THEN
        RETURN 'divergente';
    END IF;

    -- Estorno vale a partir de QUALQUER estado, e NUNCA mexe em estoque: o
    -- dinheiro entrou e voltou, possivelmente com entrega feita. Repor
    -- estoque sozinho aqui e' chutar onde a mercadoria esta.
    IF p_status = 'estornado' THEN
        IF v_pedido.payment_status = 'estornado' THEN
            RETURN 'ja_estornado';
        END IF;
        UPDATE public.marketplace_orders
           SET payment_status = 'estornado',
               updated_at     = now()
         WHERE id = p_order_id;
        RETURN 'estornado';
    END IF;

    IF p_status = 'pago' THEN
        -- Idempotencia do webhook: o MP reenvia quando nao recebe 200 rapido.
        -- A segunda chamada cai aqui e nao dispara push de novo.
        IF v_pedido.payment_status IN ('pago', 'pago_apos_expirar') THEN
            RETURN 'ja_pago';
        END IF;

        -- A varredura ganhou a corrida: o estoque JA voltou. Nao mexer em
        -- estoque nem em status — so marcar e chamar uma pessoa.
        IF v_pedido.payment_status = 'expirado' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'pago_apos_expirar',
                   paid_at        = now(),
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'pago_apos_expirar';
        END IF;

        IF v_pedido.payment_status = 'aguardando' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'pago',
                   paid_at        = now(),
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'pago';
        END IF;

        -- 'recusado', NULL (os 64 pedidos historicos) ou qualquer outro:
        -- nao inventar transicao.
        RETURN 'ignorado';
    END IF;

    IF p_status = 'recusado' THEN
        -- devolver_estoque NAO e' idempotente (ver o COMMENT dela). So se
        -- chama a partir de 'aguardando', que e' a unica transicao que
        -- acontece uma vez, e de dentro desta trava.
        IF v_pedido.payment_status <> 'aguardando' THEN
            RETURN 'ignorado';
        END IF;

        PERFORM public.devolver_estoque(p_order_id);

        UPDATE public.marketplace_orders
           SET payment_status = 'recusado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = p_order_id;
        RETURN 'recusado';
    END IF;

    -- 'aguardando' vindo do MP (pending/in_process) cai aqui: nada a fazer,
    -- o pedido ja esta nesse estado e a expiracao cuida do prazo.
    RETURN 'ignorado';
END;
$confirmar$;

REVOKE ALL ON FUNCTION public.confirmar_pagamento(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.confirmar_pagamento(uuid, text, text) IS
  'Unico caminho que escreve payment_status a partir do gateway. O webhook e a '
  'reconciliacao chamam ESTA funcao — nao um UPDATE proprio — porque a decisao '
  'depende de reler o estado sob FOR UPDATE, e nao do WHERE da chamada.';
