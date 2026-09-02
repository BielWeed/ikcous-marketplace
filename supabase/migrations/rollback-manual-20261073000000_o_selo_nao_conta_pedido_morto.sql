-- ============================================================================
-- ROLLBACK MANUAL — 20261073000000 (selo não conta pedido morto)
-- ============================================================================
-- Restaura os corpos EXATOS da 20261030 (sem o portão de status). Depois do
-- rollback, pedido pago-que-virou-cancelado volta a conferir selo (o estado
-- que o laudo L-10 apontou).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.marca_avaliacao_nasce_verificada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.marketplace_orders o
        JOIN public.marketplace_order_items oi ON oi.order_id = o.id
        WHERE o.user_id = NEW.user_id
          AND oi.product_id = NEW.product_id
          AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
    ) THEN
        UPDATE public.reviews SET verified = true WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.marca_avaliacoes_do_pedido_verificadas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.user_id IS NOT NULL
       AND NEW.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') THEN
        UPDATE public.reviews r
           SET verified = true
         WHERE r.user_id = NEW.user_id
           AND r.verified = false
           AND EXISTS (
               SELECT 1 FROM public.marketplace_order_items oi
               WHERE oi.order_id = NEW.id
                 AND oi.product_id = r.product_id
           );
    END IF;
    RETURN NEW;
END;
$$;
