-- Migration: Harden create_marketplace_order_v14 to check product/variant activity
-- Date: 2026-03-04 (Simulated 2026-03-13 for sequence)

BEGIN;

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v14(
    p_items JSONB,
    p_payment_method TEXT,
    p_address_id UUID,
    p_coupon_code TEXT DEFAULT NULL,
    p_customer_name TEXT DEFAULT NULL,
    p_customer_phone TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := COALESCE(p_user_id, auth.uid());
    v_order_id UUID;
    v_subtotal NUMERIC := 0;
    v_discount NUMERIC := 0;
    v_shipping NUMERIC := 0;
    v_total NUMERIC := 0;
    v_item RECORD;
    v_item_price NUMERIC;
    v_item_name TEXT;
    v_item_image TEXT;
    v_config RECORD;
    v_coupon_record RECORD;
    v_processed_items JSONB := '[]'::JSONB;
BEGIN
    -- 0. Auth & BOLA Check
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;
    IF v_user_id != auth.uid() AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Tentativa de BOLA detectada.';
    END IF;

    -- 1. Verify Address Ownership
    IF p_address_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'Endereço inválido hoặc không thuộc sở hữu của người dùng.';
    END IF;

    -- 2. Fetch Store Config
    SELECT * INTO v_config FROM public.store_config WHERE id = 1;
    v_shipping := COALESCE(v_config.shipping_fee, 0);

    -- 3. Validation & Pricing
    FOR v_item IN 
        SELECT product_id, variant_id, quantity 
        FROM jsonb_to_recordset(p_items) AS x(product_id UUID, variant_id UUID, quantity INTEGER)
        ORDER BY product_id ASC, variant_id ASC NULLS FIRST
    LOOP
        IF v_item.quantity <= 0 THEN RAISE EXCEPTION 'Số lượng không hợp lệ.'; END IF;

        -- Hardening: Check if product is active (ativo = true)
        SELECT nome, imagem_url, preco_venda INTO v_item_name, v_item_image, v_item_price
        FROM public.produtos 
        WHERE id = v_item.product_id AND ativo = true 
        FOR NO KEY UPDATE;
        
        IF v_item_name IS NULL THEN 
            RAISE EXCEPTION 'Sản phẩm không tìm thấy hoặc đã ngừng kinh doanh.'; 
        END IF;

        IF v_item.variant_id IS NOT NULL THEN
            -- Hardening: Check if variant is active (active = true)
            SELECT price_override INTO v_item_price
            FROM public.product_variants 
            WHERE id = v_item.variant_id 
              AND product_id = v_item.product_id 
              AND active = true 
            FOR NO KEY UPDATE;
            
            IF v_item_price IS NULL THEN 
                RAISE EXCEPTION 'Biến thể không tìm thấy hoặc không khả dụng.'; 
            END IF;
        END IF;

        v_subtotal := v_subtotal + (v_item_price * v_item.quantity);
        
        v_processed_items := v_processed_items || jsonb_build_object(
            'product_id', v_item.product_id,
            'variant_id', v_item.variant_id,
            'product_name', v_item_name,
            'image_url', v_item_image,
            'quantity', v_item.quantity,
            'price', v_item_price
        );
    END LOOP;

    -- 4. Shipping Logic
    IF v_config.free_shipping_min IS NOT NULL AND v_subtotal >= v_config.free_shipping_min THEN
        v_shipping := 0;
    END IF;

    -- 5. Coupon Logic
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT * INTO v_coupon_record FROM public.coupons 
        WHERE code = p_coupon_code AND active = true FOR UPDATE;
        
        IF v_coupon_record.id IS NOT NULL THEN
            IF (v_coupon_record.valid_until IS NULL OR v_coupon_record.valid_until >= NOW()) AND
               (v_coupon_record.usage_limit IS NULL OR v_coupon_record.usage_count < v_coupon_record.usage_limit) AND
               (v_coupon_record.min_purchase IS NULL OR v_subtotal >= v_coupon_record.min_purchase) 
            THEN
                IF v_coupon_record.type = 'percentage' THEN
                    v_discount := (v_subtotal * v_coupon_record.value / 100);
                ELSE
                    v_discount := v_coupon_record.value;
                END IF;
                IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
                UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_record.id;
            ELSE
                RAISE EXCEPTION 'Mã giảm giá không hợp lệ hoặc đã hết hạn.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Mã giảm giá không tìm thấy.';
        END IF;
    END IF;

    v_total := v_subtotal + v_shipping - v_discount;

    -- 6. Insert Final Order
    INSERT INTO public.marketplace_orders (
        user_id, total, subtotal, shipping, discount, 
        payment_method, status, coupon_code,
        customer_name, customer_data, notes
    ) VALUES (
        v_user_id, v_total, v_subtotal, v_shipping, v_discount,
        p_payment_method, 'new', p_coupon_code,
        p_customer_name, 
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id), 
        p_notes
    ) RETURNING id INTO v_order_id;

    -- 7. Insert Items
    INSERT INTO public.marketplace_order_items (
        order_id, product_id, variant_id, product_name, quantity, price, image_url
    )
    SELECT 
        v_order_id, (x->>'product_id')::UUID, (x->>'variant_id')::UUID, 
        (x->>'product_name'), (x->>'quantity')::INTEGER, (x->>'price')::NUMERIC, (x->>'image_url')
    FROM jsonb_array_elements(v_processed_items) AS x;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION create_marketplace_order_v14 TO authenticated;

COMMIT;
