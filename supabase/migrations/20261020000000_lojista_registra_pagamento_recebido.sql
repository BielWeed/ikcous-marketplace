-- A loja passa a poder registrar, pela tela, que recebeu o pagamento na mao.
--
-- Migration ADITIVA: nao nega nada do que ja existe. Acrescenta duas colunas
-- em marketplace_orders (quando e quem confirmou o recebimento), uma tabela
-- de historico propria para essa confirmacao, e a RPC
-- registrar_pagamento_recebido, que e' quem escreve nas duas.
--
-- Sem BEGIN/COMMIT de proposito: com eles o ROLLBACK do script de prova vira
-- no-op.

-- 1. As duas colunas novas em marketplace_orders --------------------------
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS pagamento_recebido_em timestamptz;

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS pagamento_recebido_por uuid;

COMMENT ON COLUMN public.marketplace_orders.pagamento_recebido_em IS
  'NULL = o lojista ainda nao confirmou recebimento.';

COMMENT ON COLUMN public.marketplace_orders.pagamento_recebido_por IS
  'qual admin confirmou.';

-- 2. Tabela de historico de confirmacao de pagamento -----------------------
--    Lista propria, nao a marketplace_order_history, que guarda status do
--    PEDIDO (natureza diferente).
CREATE TABLE IF NOT EXISTS public.marketplace_order_payment_history (
    id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id              uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
    acao                  text NOT NULL CHECK (acao IN ('recebido', 'desfeito')),
    payment_status_antes  text,
    payment_status_depois text,
    created_by            uuid,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mkt_order_payment_history_order
    ON public.marketplace_order_payment_history (order_id, created_at DESC);

ALTER TABLE public.marketplace_order_payment_history ENABLE ROW LEVEL SECURITY;

-- Uma unica policy, so' de leitura e so' para admin. Nao ha policy de
-- INSERT/UPDATE/DELETE: quem escreve e' a RPC abaixo, que e' SECURITY
-- DEFINER e passa por cima do RLS.
DROP POLICY IF EXISTS mkt_order_payment_history_select ON public.marketplace_order_payment_history;
CREATE POLICY mkt_order_payment_history_select
    ON public.marketplace_order_payment_history
    FOR SELECT
    USING (public.is_admin());

-- 3. registrar_pagamento_recebido: so' o lojista aciona ---------------------
CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(
    p_order_id uuid,
    p_recebido boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status          TEXT;
    v_payment_status  TEXT;
    v_payment_method  TEXT;
    v_caller          UUID := auth.uid();
    v_antes           TEXT;
    v_depois          TEXT;
    v_ja_estava       BOOLEAN := FALSE;
    v_recebido_em     TIMESTAMPTZ;
    v_recebido_por    UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';
    END IF;

    SELECT status, payment_status, payment_method,
           pagamento_recebido_em, pagamento_recebido_por
      INTO v_status, v_payment_status, v_payment_method,
           v_recebido_em, v_recebido_por
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Pedido cancelado não recebe pagamento.';
    END IF;

    IF v_payment_method = 'online' THEN
        RAISE EXCEPTION 'Este pedido é pago pelo site: quem confirma o pagamento é o gateway, não a loja.';
    END IF;

    v_antes := v_payment_status;

    IF p_recebido THEN
        IF v_payment_status = 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSIF v_payment_status IS NOT NULL THEN
            RAISE EXCEPTION 'Este pedido já tem pagamento registrado como "%": não dá para marcar recebimento na entrega por cima.', v_payment_status;
        ELSE
            v_depois := 'recebido_na_entrega';
            UPDATE public.marketplace_orders
               SET payment_status = v_depois,
                   pagamento_recebido_em = now(),
                   pagamento_recebido_por = v_caller,
                   updated_at = now()
             WHERE id = p_order_id
             RETURNING pagamento_recebido_em, pagamento_recebido_por
                  INTO v_recebido_em, v_recebido_por;
        END IF;
    ELSE
        IF v_payment_status IS DISTINCT FROM 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSE
            v_depois := NULL;
            UPDATE public.marketplace_orders
               SET payment_status = NULL,
                   pagamento_recebido_em = NULL,
                   pagamento_recebido_por = NULL,
                   updated_at = now()
             WHERE id = p_order_id;
            v_recebido_em := NULL;
            v_recebido_por := NULL;
        END IF;
    END IF;

    IF NOT v_ja_estava THEN
        INSERT INTO public.marketplace_order_payment_history
            (order_id, acao, payment_status_antes, payment_status_depois, created_by)
        VALUES
            (p_order_id,
             CASE WHEN p_recebido THEN 'recebido' ELSE 'desfeito' END,
             v_antes, v_depois, v_caller);
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'payment_status', v_depois,
        'pagamento_recebido_em', v_recebido_em,
        'pagamento_recebido_por', v_recebido_por,
        'ja_estava', v_ja_estava
    );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) TO service_role;
