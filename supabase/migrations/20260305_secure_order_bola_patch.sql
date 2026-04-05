-- 20260305_secure_order_bola_patch.sql
-- Security Hardening Patch: Fix BOLA in create_marketplace_order
-- Objective: Ensure user_id cannot be spoofed by overriding the client-provided p_user_id with the definitive auth.uid()

DROP FUNCTION IF EXISTS public.create_marketplace_order_v6(jsonb, text, uuid, text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_marketplace_order_v6() CASCADE;

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v6(
    p_items JSONB,
    p_payment_method TEXT,
    p_address_id UUID,
    p_coupon_code TEXT,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_notes TEXT
)
RETURNS UUID AS $$
DECLARE
    v_order_id UUID;
    v_item RECORD;
    v_current_price NUMERIC;
    v_variant_price_override NUMERIC;
    v_subtotal NUMERIC := 0;
    v_total NUMERIC := 0;
    v_discount NUMERIC := 0;
    v_shipping NUMERIC := 0;
    v_config RECORD;
    v_coupon_record RECORD;
    v_item_price NUMERIC;
    v_items_with_pricing JSONB := '[]'::JSONB;
    v_real_user_id UUID;
BEGIN
    -- Secure User Resolution (Prevents BOLA)
    v_real_user_id := auth.uid();

    -- 0. Fetch Store Config for Shipping logic
    SELECT * INTO v_config FROM public.store_config WHERE id = 1;
    v_shipping := COALESCE(v_config.shipping_fee, 0);

    -- 1. Validate and Calculate Prices
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, variant_id UUID, quantity INTEGER)
    LOOP
        IF v_item.quantity <= 0 THEN RAISE EXCEPTION 'Quantidade deve ser positiva.'; END IF;
        IF v_item.quantity > 500 THEN RAISE EXCEPTION 'Quantidade excede o limite (500).'; END IF;

        SELECT preco_venda INTO v_current_price FROM public.produtos WHERE id = v_item.product_id;
        IF v_current_price IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;

        IF v_item.variant_id IS NOT NULL THEN
            SELECT price_override INTO v_variant_price_override FROM public.product_variants WHERE id = v_item.variant_id;
            v_item_price := COALESCE(v_variant_price_override, v_current_price);
        ELSE
            v_item_price := v_current_price;
        END IF;

        v_subtotal := v_subtotal + (v_item_price * v_item.quantity);
        
        v_items_with_pricing := v_items_with_pricing || jsonb_build_object(
            'product_id', v_item.product_id,
            'variant_id', v_item.variant_id,
            'quantity', v_item.quantity,
            'price', v_item_price
        );
    END LOOP;

    -- 2. Shipping Logic (Server-side)
    IF v_config.free_shipping_min IS NOT NULL AND v_subtotal >= v_config.free_shipping_min THEN
        v_shipping := 0;
    END IF;

    -- 3. Validate Coupon
    IF p_coupon_code IS NOT NULL AND p_coupon_code <> '' THEN
        SELECT * INTO v_coupon_record FROM public.coupons WHERE code = p_coupon_code AND active = true;
        
        IF v_coupon_record.id IS NOT NULL THEN
            IF v_coupon_record.valid_until IS NULL OR v_coupon_record.valid_until >= NOW() THEN
                IF v_coupon_record.usage_limit IS NULL OR v_coupon_record.usage_count < v_coupon_record.usage_limit THEN
                    IF v_coupon_record.min_purchase IS NULL OR v_subtotal >= v_coupon_record.min_purchase THEN
                        IF v_coupon_record.type = 'percentage' THEN
                            v_discount := (v_subtotal * v_coupon_record.value) / 100;
                        ELSE
                            v_discount := v_coupon_record.value;
                        END IF;
                        IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
                    END IF;
                END IF;
            END IF;
        END IF;
    END IF;

    v_total := v_subtotal + v_shipping - v_discount;

    -- 4. Insert Order
    INSERT INTO public.marketplace_orders (
        user_id, customer_name, customer_data, total, subtotal, 
        shipping, discount, payment_method, coupon_code, notes, status
    ) VALUES (
        v_real_user_id, p_customer_name, 
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id), 
        v_total, v_subtotal, v_shipping, v_discount, p_payment_method, p_coupon_code, p_notes, 'new'
    ) RETURNING id INTO v_order_id;

    -- 5. Insert Items
    INSERT INTO public.marketplace_order_items (
        order_id, product_id, variant_id, product_name, quantity, price, image_url
    )
    SELECT 
        v_order_id, (x->>'product_id')::UUID, (x->>'variant_id')::UUID, 
        p.nome, (x->>'quantity')::INTEGER, (x->>'price')::NUMERIC, p.imagem_url
    FROM jsonb_array_elements(v_items_with_pricing) AS x
    JOIN public.produtos p ON p.id = (x->>'product_id')::UUID;

    -- 6. Coupon usage increment
    IF v_discount > 0 THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE code = p_coupon_code;
    END IF;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
