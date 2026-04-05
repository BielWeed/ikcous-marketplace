-- 20260310_fix_coupon_race_condition.sql
-- Solo-Ninja Security Protocol: TOCTOU Fix for Coupons
-- Objective: Fix the coupon race condition by locking the coupon row with FOR UPDATE

BEGIN;

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v12(
    p_items JSONB,
    p_payment_method TEXT,
    p_address_id UUID,
    p_coupon_code TEXT,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_notes TEXT,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    v_current_stock INTEGER;
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
        RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
    END IF;

    -- 2. Fetch Store Config (Pricing model)
    SELECT * INTO v_config FROM public.store_config WHERE id = 1;
    v_shipping := COALESCE(v_config.shipping_fee, 0);

    -- 3. Calculate Prices & Validate Stock (FOR NO KEY UPDATE)
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, variant_id UUID, quantity INTEGER)
    LOOP
        IF v_item.quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

        -- Get Product info
        SELECT nome, imagem_url, preco_venda, estoque INTO v_item_name, v_item_image, v_item_price, v_current_stock 
        FROM public.produtos WHERE id = v_item.product_id FOR NO KEY UPDATE;
        
        IF v_item_name IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;

        -- Override with variant info if applicable
        IF v_item.variant_id IS NOT NULL THEN
            SELECT price_override, stock INTO v_item_price, v_current_stock 
            FROM public.product_variants WHERE id = v_item.variant_id AND product_id = v_item.product_id FOR NO KEY UPDATE;
            
            IF v_item_price IS NULL THEN RAISE EXCEPTION 'Variante não encontrada.'; END IF;
        END IF;

        -- Stock Validation
        IF v_current_stock < v_item.quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto %.', v_item_name;
        END IF;

        -- Accumulate
        v_subtotal := v_subtotal + (v_item_price * v_item.quantity);
        
        v_processed_items := v_processed_items || jsonb_build_object(
            'product_id', v_item.product_id,
            'variant_id', v_item.variant_id,
            'product_name', v_item_name,
            'image_url', v_item_image,
            'quantity', v_item.quantity,
            'price', v_item_price
        );

        -- Immediate Stock Burn (Atomic)
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants SET stock = stock - v_item.quantity WHERE id = v_item.variant_id;
        ELSE
            UPDATE public.produtos SET estoque = estoque - v_item.quantity WHERE id = v_item.product_id;
        END IF;
    END LOOP;

    -- 4. Shipping Logic
    IF v_config.free_shipping_min IS NOT NULL AND v_subtotal >= v_config.free_shipping_min THEN
        v_shipping := 0;
    END IF;

    -- 5. Coupon Logic (Strict Server-Side)
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        -- Add FOR UPDATE lock to prevent TOCTOU race conditions globally on this coupon usage
        SELECT * INTO v_coupon_record FROM public.coupons 
        WHERE code = p_coupon_code AND active = true 
        FOR UPDATE;
        
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
                -- Cap discount
                IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
                
                -- Burn Coupon usage
                UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_record.id;
            ELSE
                RAISE EXCEPTION 'Cupom inválido, expirado ou atingiu o limite de uso.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Cupom não encontrado ou inativo.';
        END IF;
    END IF;

    v_total := v_subtotal + v_shipping - v_discount;

    -- 6. Insert Final Order
    -- Using the most common column names found in recent migrations
    INSERT INTO public.marketplace_orders (
        user_id, total_amount, subtotal, shipping_cost, discount, 
        payment_method, status, address_id, coupon_code,
        customer_name, customer_data, notes
    ) VALUES (
        v_user_id, v_total, v_subtotal, v_shipping, v_discount,
        p_payment_method, 'new', p_address_id, p_coupon_code,
        p_customer_name, jsonb_build_object('whatsapp', p_customer_phone), p_notes
    ) RETURNING id INTO v_order_id;

    -- 7. Insert Items
    INSERT INTO public.marketplace_order_items (
        order_id, product_id, variant_id, product_name, quantity, price, image_url
    )
    SELECT 
        v_order_id, (x->>'product_id')::UUID, (x->>'variant_id')::UUID, 
        (x->>'product_name'), (x->>'quantity')::INTEGER, (x->>'price')::NUMERIC, (x->>'image_url')
    FROM jsonb_array_elements(v_processed_items) AS x;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'total', v_total
    );

EXCEPTION WHEN OTHERS THEN
    -- Rollback is automatic in RPC
    RETURN jsonb_build_object(
        'success', false,
        'error', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v12 TO authenticated;

COMMIT;
