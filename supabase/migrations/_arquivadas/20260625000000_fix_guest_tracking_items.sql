-- Migration: Fix Guest Tracking Orders Items Aggregation (20260625)
-- Goal: Update get_orders_by_otp_v1 and get_orders_by_whatsapp_v3 to return order items and address details nested in JSON objects.

BEGIN;

-- 1. Redefine get_orders_by_otp_v1
CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1(p_email text, p_otp text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_valid_record RECORD;
BEGIN
    -- Check if OTP is valid and not expired
    SELECT whatsapp, verified INTO v_valid_record
    FROM public.otp_verifications
    WHERE email = p_email 
    AND otp_code = p_otp 
    AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_valid_record.whatsapp IS NULL THEN
        RAISE EXCEPTION 'Código inválido ou expirado.';
    END IF;

    IF v_valid_record.verified THEN
        RAISE EXCEPTION 'Código já utilizado.';
    END IF;

    -- Mark as verified
    UPDATE public.otp_verifications 
    SET verified = TRUE 
    WHERE email = p_email AND otp_code = p_otp;

    -- Return orders associated with this email or whatsapp
    RETURN (
        SELECT COALESCE(
            jsonb_agg(
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
            ),
            '[]'::jsonb
        )
        FROM public.marketplace_orders o
        LEFT JOIN auth.users u ON u.id = o.user_id
        WHERE (
            -- Email comparison (either on customer_data or logged-in user email)
            (p_email IS NOT NULL AND p_email <> '' AND 
             (LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(p_email) 
              OR LOWER(coalesce(u.email, '')) = LOWER(p_email)))
            OR
            -- WhatsApp comparison immune to formatting (extracting only digits)
            (v_valid_record.whatsapp IS NOT NULL AND v_valid_record.whatsapp <> '' AND 
             regexp_replace(coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''), '[^0-9]', '', 'g') = regexp_replace(v_valid_record.whatsapp, '[^0-9]', '', 'g'))
        )
    );
END;
$function$;

-- 2. Drop and Redefine get_orders_by_whatsapp_v3 (changing return type to SETOF jsonb)
DROP FUNCTION IF EXISTS public.get_orders_by_whatsapp_v3(text, text, text);

CREATE OR REPLACE FUNCTION public.get_orders_by_whatsapp_v3(
    p_phone_number text,
    p_customer_email text,
    p_order_fragment text
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- 3. Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) TO anon,
authenticated;
GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(
    text, text, text
) TO anon,
authenticated;

COMMIT;
