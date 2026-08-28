-- ==============================================================================
-- 🥷 SOLO-NINJA DEFINITIVE SECURITY PATCH (v17.1)
-- ==============================================================================
-- Goal: Harden RLS for orders/addresses and create the secure v17 RPC.
-- This script is designed to be applied directly.

BEGIN;

-- 1. SECURITY DEFINER: Bulletproof is_admin
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

-- 2. HARDEN PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Profiles visibility" ON public.profiles;
DROP POLICY IF EXISTS "Profiles self-update" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Profiles visibility" ON public.profiles
FOR SELECT TO authenticated
USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "Profiles self-update" ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 3. HARDEN ADDRESSES (BOLA FIX)
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Address management" ON public.user_addresses;
DROP POLICY IF EXISTS "Users manage own addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "Users can manage their own addresses" ON public.user_addresses;

CREATE POLICY "Address management" ON public.user_addresses
FOR ALL TO authenticated
USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- 4. HARDEN ORDERS (BOLA FIX)
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Order visibility" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Order management" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users manage own orders, Admin manage all" ON public.marketplace_orders;

CREATE POLICY "Order visibility" ON public.marketplace_orders
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Order management" ON public.marketplace_orders
FOR ALL TO authenticated
USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- 5. RPC create_marketplace_order_v17
CREATE OR REPLACE FUNCTION public.create_marketplace_order_v17(
    p_items jsonb,
    p_total_amount numeric,
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
    v_price numeric;
    v_current_stock integer;
    v_coupon_id uuid;
    v_discount_amount numeric := 0;
BEGIN
    -- [SECURITY] Authentication check
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Não autenticado.';
    END IF;

    -- [SECURITY] Address BOLA Check
    IF p_address_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou tentativa de BOLA detectada.';
        END IF;
    END IF;

    -- 1. Validate Coupon
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT id, value INTO v_coupon_id, v_discount_amount
        FROM public.coupons
        WHERE code = p_coupon_code 
          AND active = true 
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_count < usage_limit)
          FOR SHARE;
    END IF;

    -- 2. Insert Order
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
        p_total_amount, 
        p_shipping_cost, 
        p_payment_method, 
        p_address_id, 
        v_coupon_id, 
        'pending', 
        p_observation,
        p_customer_name,
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id)
    ) RETURNING id INTO v_order_id;

    -- 3. Process Items and Handle Stock
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        v_price := (v_item->>'price')::numeric;

        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT stock INTO v_current_stock FROM product_variants WHERE id = v_variant_id FOR UPDATE;
            IF v_current_stock < v_quantity THEN RAISE EXCEPTION 'Estoque insuficiente para variante.'; END IF;
            UPDATE product_variants SET stock = stock - v_quantity WHERE id = v_variant_id;
        ELSE
            SELECT estoque INTO v_current_stock FROM produtos WHERE id = v_product_id FOR UPDATE;
            IF v_current_stock < v_quantity THEN RAISE EXCEPTION 'Estoque insuficiente para produto.'; END IF;
            UPDATE produtos SET estoque = estoque - v_quantity WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_price
        );
    END LOOP;

    -- 4. Finalize Coupon
    IF v_coupon_id IS NOT NULL THEN
        UPDATE coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v17 TO authenticated;

COMMIT;
