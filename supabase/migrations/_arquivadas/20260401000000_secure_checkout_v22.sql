-- 20260401_secure_checkout_v22.sql
-- Goal: Eliminate client-side price manipulation by moving all calculations to the server.

BEGIN;

-- 1. Create the new Secure RPC v22
CREATE OR REPLACE FUNCTION public.create_marketplace_order_v22(
    p_items jsonb,
    p_payment_method text,
    p_address_id uuid,
    p_coupon_code text DEFAULT NULL,
    p_customer_name text DEFAULT NULL,
    p_customer_phone text DEFAULT NULL,
    p_observation text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    
    v_db_price numeric;
    v_db_stock integer;
    v_calculated_subtotal numeric := 0;
    v_calculated_total numeric := 0;
    v_shipping_validated numeric := 0;
    v_discount_amount numeric := 0;
    v_coupon_id uuid;
    
    v_store_config RECORD;
BEGIN
    -- [SECURITY] Auth check
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

    -- [SECURITY] Address BOLA check
    IF p_address_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou tentativa de BOLA detectada.';
        END IF;
    END IF;

    -- 1. Load Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- 2. Validate Items & Calculate Subtotal (Server-side Truth)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida para o item %', v_product_id; END IF;

        -- Fetch real DB price/stock with row-level lock
        IF v_variant_id IS NOT NULL THEN
            SELECT 
                COALESCE(v.price_override, p.preco_venda), v.stock_increment
            INTO v_db_price, v_db_stock
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
              AND v.active = true AND p.ativo = true
            FOR NO KEY UPDATE OF v;
        ELSE
            SELECT preco_venda, estoque
            INTO v_db_price, v_db_stock
            FROM public.produtos
            WHERE id = v_product_id AND ativo = true
            FOR NO KEY UPDATE;
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto % não encontrado ou inativo.', v_product_id; END IF;
        IF v_db_stock < v_quantity THEN RAISE EXCEPTION 'Estoque insuficiente para o produto %.', v_product_id; END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
    END LOOP;

    -- 3. Calculate Shipping (Business logic on server)
    IF v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

    -- 4. Validate Coupon & Calculate Discount (Server-side Truth)
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT id, value INTO v_coupon_id, v_discount_amount
        FROM public.coupons
        WHERE code = p_coupon_code 
          AND active = true 
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_count < usage_limit)
          AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)
          FOR SHARE;
          
        IF v_coupon_id IS NULL THEN
            RAISE EXCEPTION 'Cupom % inválido ou expirado para este valor de compra.', p_coupon_code;
        END IF;
    END IF;

    -- 5. Final Total Calculation
    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Insert Order
    INSERT INTO public.marketplace_orders (
        user_id, 
        total_amount, 
        shipping_cost, 
        payment_method, 
        address_id, 
        coupon_id, 
        status, 
        observation,
        customer_name,
        customer_data,
        subtotal -- Assuming subtotal exists or we want to track it
    ) VALUES (
        v_user_id, 
        v_calculated_total, 
        v_shipping_validated, 
        p_payment_method, 
        p_address_id, 
        v_coupon_id, 
        'pending', 
        p_observation,
        p_customer_name,
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id),
        v_calculated_subtotal
    ) RETURNING id INTO v_order_id;

    -- 7. Deduct Stock & Insert Item Records
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_variant_id IS NOT NULL THEN
            -- Deduct stock from variant
            UPDATE public.product_variants 
            SET stock_increment = stock_increment - v_quantity 
            WHERE id = v_variant_id;
            
            -- Fetch price again for order items record
            SELECT COALESCE(v.price_override, p.preco_venda) 
            INTO v_db_price 
            FROM public.produtos p 
            JOIN public.product_variants v ON v.product_id = p.id 
            WHERE v.id = v_variant_id;
        ELSE
            -- Deduct stock from main product
            UPDATE public.produtos 
            SET estoque = estoque - v_quantity 
            WHERE id = v_product_id;
            
            -- Fetch price again
            SELECT preco_venda INTO v_db_price FROM public.produtos WHERE id = v_product_id;
        END IF;

        -- Record the item with the PRICE AT THE TIME OF PURCHASE
        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price
        );
    END LOOP;

    -- 8. Increment Coupon usage count
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$$;

-- 2. Grant permissions
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v22 TO authenticated;

COMMIT;
