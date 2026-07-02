-- 20260320_security_patch_v21.sql
-- Goal: Harden RLS and Final RPC Logic (Solo-Ninja)

BEGIN;

-- 1. HARDENING: marketplace_orders RLS
-- Remove potentially permissive public policies
DROP POLICY IF EXISTS "Admins full access on orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Allow ALL for public" ON public.marketplace_orders;

-- Ensure RLS is enabled
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

-- Precise Policies (BOLA Protection)
CREATE POLICY "authenticated_select_own_orders"
ON public.marketplace_orders FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "admin_all_orders"
ON public.marketplace_orders FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 2. HARDENING: profiles RLS (PII Leak Protection)
-- Drop old permissive policies
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Public Read Profiles" ON public.profiles;

-- Strict Access
CREATE POLICY "profiles_owner_admin_select"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.is_admin());

-- 3. HARDENING: RPC create_marketplace_order_v20 (BPI Protection)
-- We ensure the RPC uses 'total_amount' and performs strict server-side calculation
CREATE OR REPLACE FUNCTION public.create_marketplace_order_v21(
    p_items jsonb,
    p_total_amount numeric, -- Sent for parity check, but DB is the source of truth
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

    -- 2. Validate Items & Calculate Subtotal REAL (Server-side Truth)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

        -- Fetch real DB price/stock
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

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto não encontrado ou inativo.'; END IF;
        IF v_db_stock < v_quantity THEN RAISE EXCEPTION 'Estoque insuficiente.'; END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
    END LOOP;

    -- 3. Validate Shipping (Business Rule Ownership)
    IF v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

    -- 4. Validate Coupon (Server-side Truth)
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

    -- 5. FINAL CALCULATION (DB Truth)
    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. [CRITICAL SECURITY CHECK] BPI Protection
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Manipulação de preço detectada.';
    END IF;

    -- 7. Insert Order
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

    -- 8. Deduct Stock & Insert Items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_variant_id IS NOT NULL THEN
            UPDATE public.product_variants SET stock_increment = stock_increment - v_quantity WHERE id = v_variant_id;
            SELECT COALESCE(v.price_override, p.preco_venda) INTO v_db_price FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
        ELSE
            UPDATE public.produtos SET estoque = estoque - v_quantity WHERE id = v_product_id;
            SELECT preco_venda INTO v_db_price FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price
        );
    END LOOP;

    -- 9. Increment Coupon usage
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v21 TO authenticated;

COMMIT;
