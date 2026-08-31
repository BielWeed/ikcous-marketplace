-- ROLLBACK MANUAL de 20261035000000_fragmento_do_pedido_nao_aceita_curinga
-- (laudo caça-bugs do molde, 30-31/08/2026, achado A4).
--
-- Devolve o corpo VERBATIM do baseline (20260806000000:2359-2434), SEM a
-- guarda de curinga. ⚠️ O rollback REABRE o buraco medido no laudo (____
-- devolve o histórico inteiro do usuário) — rodar só se a guarda nova
-- quebrar uma busca legítima, e consertar o conserto na sequência.
--
-- Assinatura idêntica (sem sobrecarga). SEM BEGIN/COMMIT.

CREATE OR REPLACE FUNCTION public.get_orders_by_whatsapp_v3("p_phone_number" "text", "p_customer_email" "text", "p_order_fragment" "text") RETURNS SETOF "jsonb"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF LENGTH(p_order_fragment) < 4 THEN
        RAISE EXCEPTION 'Fragmento muito curto. Informe pelo menos 4 dígitos.';
    END IF;

    SELECT id INTO v_user_id
    FROM auth.users
    WHERE (phone = p_phone_number OR raw_user_meta_data->>'whatsapp' = p_phone_number)
      AND email = p_customer_email;

    IF v_user_id IS NULL THEN RETURN; END IF;

    RETURN QUERY
    SELECT
        jsonb_build_object(
            'id', o.id,
            'user_id', o.user_id,
            'total', o.total,
            'subtotal', o.subtotal,
            'shipping', o.shipping,
            'discount', o.discount,
            'payment_method', o.payment_method,
            'status', o.status,
            'notes', o.notes,
            'coupon_code', o.coupon_code,
            'tracking_code', o.tracking_code,
            'created_at', o.created_at,
            'updated_at', o.updated_at,
            'customer_name', o.customer_name,
            'customer_data', o.customer_data,
            'items', (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object(
                            'id', oi.id,
                            'order_id', oi.order_id,
                            'product_id', oi.product_id,
                            'variant_id', oi.variant_id,
                            'quantity', oi.quantity,
                            'price', oi.price,
                            'product_name', oi.product_name,
                            'image_url', oi.image_url
                        )
                    ),
                    '[]'::jsonb
                )
                FROM public.marketplace_order_items oi
                WHERE oi.order_id = o.id
            ),
            'address', (
                SELECT to_jsonb(addr.*)
                FROM public.user_addresses addr
                WHERE addr.id = o.address_id
            )
        )
    FROM public.marketplace_orders o
    WHERE o.user_id = v_user_id
    AND (o.id::text LIKE '%' || p_order_fragment OR o.tracking_code LIKE '%' || p_order_fragment)
    ORDER BY o.created_at DESC;
END;
$$;
