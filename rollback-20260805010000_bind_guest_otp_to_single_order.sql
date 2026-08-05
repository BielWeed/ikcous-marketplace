-- Rollback gerado automaticamente antes de aplicar: 20260805010000_bind_guest_otp_to_single_order.sql
-- Para desfazer, rode este arquivo inteiro no SQL Editor.

-- generate_order_otp_v1
CREATE OR REPLACE FUNCTION public.generate_order_otp_v1(p_email text, p_whatsapp text, p_order_fragment text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_otp TEXT;
    v_exists BOOLEAN;
BEGIN
    -- [CLEANUP] Exclude expired OTP records
    DELETE FROM public.otp_verifications WHERE expires_at < NOW();

    -- Validate if a matching order exists
    -- p_order_fragment should match the END of an order ID for this email/whatsapp
    -- Using ILIKE for case-insensitive and matching the end
    SELECT EXISTS (
        SELECT 1 FROM public.marketplace_orders o
        LEFT JOIN auth.users u ON u.id = o.user_id
        WHERE (
            -- WhatsApp comparison immune to formatting (extracting only digits)
            (p_whatsapp IS NOT NULL AND p_whatsapp <> '' AND 
             regexp_replace(coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''), '[^0-9]', '', 'g') = regexp_replace(p_whatsapp, '[^0-9]', '', 'g'))
            OR
            -- Email comparison (either on customer_data or logged-in user email)
            (p_email IS NOT NULL AND p_email <> '' AND 
             (LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(p_email) 
              OR LOWER(coalesce(u.email, '')) = LOWER(p_email)))
        )
        AND o.id::text ILIKE '%' || p_order_fragment
    ) INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'Dados do pedido não encontrados.';
    END IF;

    -- Generate a 6-digit OTP
    v_otp := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

    -- Insert into verifications table
    INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at)
    VALUES (p_email, p_whatsapp, v_otp, NOW() + INTERVAL '15 minutes');

    RETURN TRUE;
END;
$function$
;

-- get_orders_by_otp_v1
CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1(p_email text, p_otp text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
;
