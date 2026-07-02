-- 20260320_security_logic_fix_v20.sql
-- Goal: Fix Price Manipulation and Increase WhatsApp Search Entropy (Solo-Ninja)

BEGIN;

-- 1. Create create_marketplace_order_v20 (The Safe One)
CREATE OR REPLACE FUNCTION public.create_marketplace_order_v20(
    p_items jsonb,
    p_total_amount numeric, -- Passado para referência, mas validado no servidor
    p_shipping_cost numeric,
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
    v_discount_amount numeric := 0;
    v_coupon_id uuid;
    
    v_store_config RECORD;
    v_shipping_validated numeric;
BEGIN
    -- [SECURITY] Auth
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

    -- [SECURITY] Address BOLA
    IF p_address_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou tentativa de BOLA detectada.';
        END IF;
    END IF;

    -- 1. Obter configurações da loja para validação de frete
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- 2. Validar Itens e Calcular Subtotal REAL (Server-side Truth)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

        -- Buscar dados reais do DB
        IF v_variant_id IS NOT NULL THEN
            SELECT 
                COALESCE(v.price_override, p.preco_venda), v.stock_increment
            INTO v_db_price, v_db_stock
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
            FOR SHARE OF v;
        ELSE
            SELECT preco_venda, estoque
            INTO v_db_price, v_db_stock
            FROM public.produtos
            WHERE id = v_product_id
            FOR SHARE;
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto não encontrado ou inativo.'; END IF;
        IF v_db_stock < v_quantity THEN RAISE EXCEPTION 'Estoque insuficiente para o produto %', COALESCE(v_product_id::text, 'não identificado'); END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
    END LOOP;

    -- 3. Validar Custo de Frete (Regra de Negócio no Servidor)
    IF v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

    -- 4. Validar Cupom (Server-side Truth)
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
            RAISE EXCEPTION 'Cupom inválido, expirado ou valor mínimo não atingido.';
        END IF;
    END IF;

    -- 5. CÁLCULO FINAL DO TOTAL (A VERDADE DO BANCO)
    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. [CRITICAL SECURITY CHECK] Comparar com o enviado
    -- Margem de 0.05 para arredondamentos
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Manipulação de preço detectada. Valor real: %, Valor enviado: %', v_calculated_total, p_total_amount;
    END IF;

    -- 7. Inserir Pedido
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
        customer_data
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
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id)
    ) RETURNING id INTO v_order_id;

    -- 8. Baixar estoque e Inserir Itens
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_variant_id IS NOT NULL THEN
            SELECT COALESCE(v.price_override, p.preco_venda) INTO v_db_price FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
            UPDATE public.product_variants SET stock_increment = stock_increment - v_quantity WHERE id = v_variant_id;
        ELSE
            SELECT preco_venda INTO v_db_price FROM public.produtos WHERE id = v_product_id;
            UPDATE public.produtos SET estoque = estoque - v_quantity WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price
        );
    END LOOP;

    -- 9. Incrementar uso do cupom
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$$;

-- 2. Create get_orders_by_whatsapp_v3 (Higher Entropy)
CREATE OR REPLACE FUNCTION public.get_orders_by_whatsapp_v3(
    p_phone_number TEXT,
    p_customer_email TEXT,
    p_order_fragment TEXT -- Exige 6 digitos para dificultar brute-force
)
RETURNS SETOF public.marketplace_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF LENGTH(p_order_fragment) < 6 THEN
        RAISE EXCEPTION 'Fragmento muito curto. Informe pelo menos 6 dígitos para sua segurança.';
    END IF;

    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE (phone = p_phone_number OR raw_user_meta_data->>'whatsapp' = p_phone_number) 
      AND email = p_customer_email;

    IF v_user_id IS NULL THEN RETURN; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.marketplace_orders 
        WHERE user_id = v_user_id 
        AND (id::text LIKE '%' || p_order_fragment OR tracking_code LIKE '%' || p_order_fragment)
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY 
    SELECT * FROM public.marketplace_orders 
    WHERE user_id = v_user_id
    ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v20 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3 TO anon, authenticated;

COMMIT;
