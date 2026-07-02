-- 20260309_solo_ninja_v12_final_security_consolidation.sql
-- Solo-Ninja Security Protocol: Final Consolidation & RPC v12
-- Objective: Eliminate legacy shadow RPCs, unify order logic, and enforce server-side price/stock/coupon validation.

BEGIN;

-- 1. DROP Legacy Shadow RPCs (Eliminate attack surface)
DROP FUNCTION IF EXISTS public.create_marketplace_order_v3(jsonb, text, uuid, text, text, text, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_marketplace_order_v7(uuid, jsonb, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_marketplace_order_v8(uuid, jsonb, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.create_marketplace_order_v9(jsonb, text, uuid, text, text, text, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_marketplace_order_v10(jsonb, text, uuid, text, text, text, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_marketplace_order_v11(uuid, jsonb, numeric, numeric, text, uuid, text, text) CASCADE;

-- 2. Consolidate is_admin() - High Performance & Security Definer
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$;

-- 3. Robust Coupon Validation RPC (Used for UI feedback, but calculation is duplicated in Order RPC for safety)
CREATE OR REPLACE FUNCTION public.validate_coupon_secure_v2(p_code TEXT, p_subtotal NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_coupon RECORD;
    v_discount NUMERIC := 0;
    v_is_valid BOOLEAN := FALSE;
    v_error TEXT := '';
BEGIN
    SELECT * INTO v_coupon FROM public.coupons 
    WHERE code = p_code AND active = true;

    IF v_coupon.id IS NULL THEN
        v_error := 'Cupom inválido ou expirado.';
    ELSIF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < NOW() THEN
        v_error := 'Este cupom expirou.';
    ELSIF (v_coupon.usage_limit IS NOT NULL OR v_coupon.usage_limit > 0) AND v_coupon.usage_count >= v_coupon.usage_limit THEN
        v_error := 'Cupom atingiu o limite de uso.';
    ELSIF v_coupon.min_purchase IS NOT NULL AND p_subtotal < v_coupon.min_purchase THEN
        v_error := 'Valor mínimo não atingido.';
    ELSE
        v_is_valid := TRUE;
        IF v_coupon.type = 'percentage' THEN
            v_discount := (p_subtotal * v_coupon.value) / 100;
        ELSE
            v_discount := v_coupon.value;
        END IF;
        
        -- Cap discount at subtotal
        IF v_discount > p_subtotal THEN v_discount := p_subtotal; END IF;
    END IF;

    RETURN jsonb_build_object(
        'is_valid', v_is_valid,
        'discount_value', v_discount,
        'error_message', v_error
    );
END;
$$;

-- 4. THE ULTIMATE RPC: create_marketplace_order_v12
-- Aligned with Frontend parameters but calculating everything Server-Side.
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
        SELECT * INTO v_coupon_record FROM public.coupons WHERE code = p_coupon_code AND active = true;
        
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
            END IF;
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

-- 8. Permissions
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v12 TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon_secure_v2 TO authenticated;

COMMIT;
