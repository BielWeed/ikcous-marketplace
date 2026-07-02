-- 20260331_fix_order_schema_final.sql
-- Goal: Align marketplace_orders schema with the expectations of create_marketplace_order_v21 and frontend parameters

BEGIN;

-- 1. Ensure missing columns exist in marketplace_orders
DO $$ 
BEGIN 
    -- Column for customer phone (whatsapp)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marketplace_orders' AND column_name='customer_phone') THEN
        ALTER TABLE public.marketplace_orders ADD COLUMN customer_phone TEXT;
    END IF;

    -- Standardize total_amount (many RPCs use this, others use 'total')
    -- We will keep 'total' as primary but add 'total_amount' if needed or align RPC to 'total'
    -- Actually, let's check which is more common. Most recent migrations used 'total'.
    -- If RPC uses total_amount, we add it as an alias or update RPC. 
    -- Adding total_amount column for maximum compatibility with all RPC versions.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marketplace_orders' AND column_name='total_amount') THEN
        ALTER TABLE public.marketplace_orders ADD COLUMN total_amount NUMERIC;
    END IF;

    -- Standardize shipping_cost
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marketplace_orders' AND column_name='shipping_cost') THEN
        ALTER TABLE public.marketplace_orders ADD COLUMN shipping_cost NUMERIC;
    END IF;

    -- Observation column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marketplace_orders' AND column_name='observation') THEN
        ALTER TABLE public.marketplace_orders ADD COLUMN observation TEXT;
    END IF;
END $$;

-- 2. Sync data if columns were just added
UPDATE public.marketplace_orders SET total_amount = total WHERE total_amount IS NULL;
UPDATE public.marketplace_orders SET shipping_cost = shipping WHERE shipping_cost IS NULL;
UPDATE public.marketplace_orders SET observation = notes WHERE observation IS NULL;

-- 3. Drop existing function to avoid signature conflicts during upgrade
DROP FUNCTION IF EXISTS public.create_marketplace_order_v21(jsonb, numeric, numeric, text, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.create_marketplace_order_v21(jsonb, numeric, numeric, text, uuid, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.create_marketplace_order_v21;

-- 4. Update the RPC to be consistent with the most robust version (using the schema we just fixed)
CREATE OR REPLACE FUNCTION public.create_marketplace_order_v21(
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
    v_item_name text;
    v_item_image_url text;
    
    v_db_price numeric;
    v_db_stock integer;
    v_calculated_subtotal numeric := 0;
    v_calculated_total numeric := 0;
    v_discount_amount numeric := 0;
    v_coupon_id uuid;
    
    v_store_config RECORD;
    v_shipping_validated numeric;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Não autenticado.'; END IF;

    IF p_address_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido.';
        END IF;
    END IF;

    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT COALESCE(v.price_override, p.preco_venda), v.stock_increment
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

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
        IF v_db_stock < v_quantity THEN RAISE EXCEPTION 'Estoque insuficiente.'; END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
    END LOOP;

    IF v_calculated_subtotal >= COALESCE(v_store_config.free_shipping_min, 999999) THEN
        v_shipping_validated := 0;
    ELSE
        v_shipping_validated := COALESCE(v_store_config.shipping_fee, 0);
    END IF;

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
            RAISE EXCEPTION 'Cupom inválido.';
        END IF;
    END IF;

    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Manipulação de preço detectada. Calculado: %, Fornecido: %', v_calculated_total, p_total_amount;
    END IF;

    INSERT INTO public.marketplace_orders (
        user_id, 
        total, total_amount, 
        shipping, shipping_cost, 
        payment_method, address_id, 
        coupon_id, status, notes, observation,
        customer_name, customer_phone, customer_data,
        subtotal, discount, coupon_code
    ) VALUES (
        v_user_id, 
        v_calculated_total, v_calculated_total,
        v_shipping_validated, v_shipping_validated,
        p_payment_method, p_address_id, 
        v_coupon_id, 'pending', p_observation, p_observation,
        p_customer_name, p_customer_phone,
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id),
        v_calculated_subtotal, v_discount_amount, p_coupon_code
    ) RETURNING id INTO v_order_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;
        
        IF v_variant_id IS NOT NULL THEN
            UPDATE public.product_variants SET stock_increment = stock_increment - v_quantity WHERE id = v_variant_id;
            SELECT COALESCE(v.price_override, p.preco_venda), p.nome, p.imagem_url
            INTO v_db_price, v_item_name, v_item_image_url
            FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
        ELSE
            UPDATE public.produtos SET estoque = estoque - v_quantity WHERE id = v_product_id;
            SELECT preco_venda, nome, imagem_url INTO v_db_price, v_item_name, v_item_image_url FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price, product_name, image_url
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name, v_item_image_url
        );
    END LOOP;

    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v21 TO authenticated;

COMMIT;
