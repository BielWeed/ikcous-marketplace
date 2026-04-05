-- 20260420_standardize_orders.sql
-- Goal: Create a canonical secure order RPC and harden RLS.

BEGIN;

-- 1. Create the Canonical Secure RPC (Based on v22 logic)
-- This function is SECURITY DEFINER to bypass RLS and performs all calculations server-side.
CREATE OR REPLACE FUNCTION public.create_marketplace_order(
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
    v_product_name text;
    v_image_url text;
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

    -- 2. Validate Items & Calculate Subtotal
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT 
                COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome, p.imagem_url
            INTO v_db_price, v_db_stock, v_product_name, v_image_url
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
              AND v.active = true AND p.ativo = true
            FOR NO KEY UPDATE OF v;
        ELSE
            SELECT preco_venda, estoque, nome, imagem_url
            INTO v_db_price, v_db_stock, v_product_name, v_image_url
            FROM public.produtos
            WHERE id = v_product_id AND ativo = true
            FOR NO KEY UPDATE;
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto não encontrado ou inativo.'; END IF;
        IF v_db_stock < v_quantity THEN RAISE EXCEPTION 'Estoque insuficiente para: %', v_product_name; END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
    END LOOP;

    -- 3. Calculate Shipping
    IF v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

    -- 4. Validate Coupon
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
            RAISE EXCEPTION 'Cupom inválido ou expirado.';
        END IF;
    END IF;

    -- 5. Final Calculation
    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Insert Order
    INSERT INTO public.marketplace_orders (
        user_id, total_amount, shipping_cost, payment_method, address_id, 
        coupon_id, status, observation, customer_name, customer_data,
        subtotal, discount
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id, 
        v_coupon_id, 'pending', p_observation, p_customer_name,
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id),
        v_calculated_subtotal, v_discount_amount
    ) RETURNING id INTO v_order_id;

    -- 7. Process Items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_variant_id IS NOT NULL THEN
            UPDATE public.product_variants SET stock_increment = stock_increment - v_quantity WHERE id = v_variant_id;
            SELECT COALESCE(v.price_override, p.preco_venda), p.nome INTO v_db_price, v_product_name FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
        ELSE
            UPDATE public.produtos SET estoque = estoque - v_quantity WHERE id = v_product_id;
            SELECT preco_venda, nome INTO v_db_price, v_product_name FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price, product_name
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_product_name
        );
    END LOOP;

    -- 8. Finalize
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$$;

-- 2. Grant Restricted Execute (Authenticated Only)
GRANT EXECUTE ON FUNCTION public.create_marketplace_order TO authenticated;
-- Ensure no public access
REVOKE ALL ON FUNCTION public.create_marketplace_order FROM PUBLIC;

-- 3. Cleanup Legacy Overloads (v1 through v22)
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (
        SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        AND p.proname LIKE 'create_marketplace_order_v%'
    ) LOOP
        RAISE NOTICE 'Dropping function %.%(%)', r.nspname, r.proname, r.args;
        EXECUTE 'DROP FUNCTION ' || r.nspname || '.' || r.proname || '(' || r.args || ')';
    END LOOP;
END $$;

-- 4. Harden RLS on Tables
-- marketplace_orders
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can insert orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Admins can insert orders" ON public.marketplace_orders;

-- Only SELECT is allowed (by owner)
DROP POLICY IF EXISTS "Users can see own orders" ON public.marketplace_orders;
CREATE POLICY "Users can see own orders" ON public.marketplace_orders
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR is_admin());

-- INSERT is BLOCKED for all - must use RPC (Security Definer)
-- RLS doesn't block SECURITY DEFINER functions.

-- marketplace_order_items
ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own order items" ON public.marketplace_order_items;
CREATE POLICY "Users can view their own order items" ON public.marketplace_order_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.marketplace_orders mo
            WHERE mo.id = order_id AND (mo.user_id = auth.uid() OR is_admin())
        )
    );

COMMIT;
