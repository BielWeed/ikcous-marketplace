-- MIGRATION: 20260324_atomic_inventory_v22.sql
-- Objetivo: Garantir atomicidade na dedução de estoque e evitar race conditions.

DROP FUNCTION IF EXISTS public.create_marketplace_order_v22;

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v22(
    p_items jsonb, 
    p_total_amount numeric, 
    p_shipping_cost numeric, 
    p_payment_method text, 
    p_address_id uuid, 
    p_coupon_code text DEFAULT NULL::text, 
    p_customer_name text DEFAULT NULL::text, 
    p_customer_phone text DEFAULT NULL::text, 
    p_observation text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_item_name text;
    v_rows_affected integer;
    
    v_db_price numeric;
    v_db_stock integer;
    v_calculated_subtotal numeric := 0;
    v_calculated_total numeric := 0;
    v_discount_amount numeric := 0;
    v_coupon_id uuid;
    
    v_store_config RECORD;
    v_shipping_validated numeric;
BEGIN
    -- 0. Auth Check
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

    -- 1. Address Ownership Check
    IF p_address_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
        END IF;
    END IF;

    -- 2. Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- 3. Validation Loop (Price, Stock Lock, Subtotal Calculation)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida para um dos itens.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome
            INTO v_db_price, v_db_stock, v_item_name
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
              AND v.active = true AND p.ativo = true
            FOR NO KEY UPDATE OF v; -- Lock row for duration of transaction
        ELSE
            SELECT preco_venda, estoque, nome
            INTO v_db_price, v_db_stock, v_item_name
            FROM public.produtos
            WHERE id = v_product_id AND ativo = true
            FOR NO KEY UPDATE; -- Lock row for duration of transaction
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto % não disponível.', COALESCE(v_item_name, 'não encontrado'); END IF;
        IF v_db_stock < v_quantity THEN 
            RAISE EXCEPTION 'Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)', v_item_name, v_db_stock, v_quantity; 
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
    END LOOP;

    -- 4. Shipping Calculation
    IF v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

    -- 5. Coupon Validation
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT id, value INTO v_coupon_id, v_discount_amount
        FROM public.coupons
        WHERE UPPER(code) = UPPER(p_coupon_code) 
          AND active = true 
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_count < usage_limit)
          AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)
          FOR SHARE;
          
        IF v_coupon_id IS NULL THEN
            RAISE EXCEPTION 'Cupom % inválido ou expirado.', p_coupon_code;
        END IF;
    END IF;

    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Price Tamping Protection
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Divergência de valores detectada. Calculado: %, Fornecido: %', v_calculated_total, p_total_amount;
    END IF;

    -- 7. Create Order Header
    INSERT INTO public.marketplace_orders (
        user_id, total, shipping, payment_method, address_id, 
        coupon_id, status, notes, customer_name, customer_data,
        subtotal, discount, coupon_code
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id, 
        v_coupon_id, 'pending', p_observation, p_customer_name,
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id),
        v_calculated_subtotal, v_discount_amount, p_coupon_code
    ) RETURNING id INTO v_order_id;

    -- 8. Atomic Inventory Update and Order Items Insertion
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_variant_id IS NOT NULL THEN
            -- ATOMIC SHIELD: Update with condition and Row Count verification
            UPDATE public.product_variants 
            SET stock_increment = stock_increment - v_quantity 
            WHERE id = v_variant_id AND stock_increment >= v_quantity;
            
            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT p.nome INTO v_item_name FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT COALESCE(v.price_override, p.preco_venda), p.nome 
            INTO v_db_price, v_item_name 
            FROM public.produtos p 
            JOIN public.product_variants v ON v.product_id = p.id 
            WHERE v.id = v_variant_id;
        ELSE
            -- ATOMIC SHIELD: Update with condition and Row Count verification
            UPDATE public.produtos 
            SET estoque = estoque - v_quantity 
            WHERE id = v_product_id AND estoque >= v_quantity;
            
            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT nome INTO v_item_name FROM public.produtos WHERE id = v_product_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT preco_venda, nome INTO v_db_price, v_item_name FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price, product_name
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name
        );
    END LOOP;

    -- 9. Coupon Usage Update
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$function$;
