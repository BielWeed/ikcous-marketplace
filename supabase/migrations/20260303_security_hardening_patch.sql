-- Security Hardening Patch v1
-- Date: 2026-03-03
-- Description: Fixes Privilege Escalation in profiles and Price Manipulation in orders.

-- 1. Fix Privilege Escalation in public.profiles
-- The previous policy allowed any user to update their own role.
-- We now explicitly exclude the 'role' field from updates by non-admins.

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id)
WITH CHECK (
    auth.uid() = id 
    AND (
        -- If NOT admin, the role must remain unchanged or be NULL in the update (PostgREST detail)
        -- In practice, we use a trigger for stricter enforcement or check the old value.
        -- RLS 'WITH CHECK' doesn't easily compare to 'OLD' value without a function.
        -- So we use a security definer function for role validation.
        public.is_admin() OR (role IS NOT DISTINCT FROM (SELECT role FROM public.profiles WHERE id = auth.uid()))
    )
);

-- 2. Stricter Admin-only role management function (Trigger based is even safer)
CREATE OR REPLACE FUNCTION public.ensure_role_protection()
RETURNS TRIGGER AS $$
BEGIN
    -- If the role is being changed
    IF (OLD.role IS DISTINCT FROM NEW.role) THEN
        -- AND the executor is not an admin
        IF NOT (SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')) THEN
            -- Reset role to its old value
            NEW.role := OLD.role;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_ensure_role_protection ON public.profiles;
CREATE TRIGGER tr_ensure_role_protection
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_role_protection();

-- 3. Hardened create_marketplace_order RPC
-- This version re-calculates the prices server-side to prevent price manipulation.
CREATE OR REPLACE FUNCTION public.create_marketplace_order_v2(
    p_user_id UUID,
    p_customer_name TEXT,
    p_customer_data JSONB,
    p_shipping NUMERIC,
    p_payment_method TEXT,
    p_coupon_code TEXT,
    p_notes TEXT,
    p_items JSONB -- Array: {product_id, variant_id, quantity}
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
    v_coupon_record RECORD;
    v_item_price NUMERIC;
    v_items_with_pricing JSONB := '[]'::JSONB;
BEGIN
    -- 1. Validate and Calculate Prices
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, variant_id UUID, quantity INTEGER)
    LOOP
        -- Get base price from database
        SELECT preco_venda INTO v_current_price FROM public.produtos WHERE id = v_item.product_id FOR UPDATE;
        
        IF v_current_price IS NULL THEN
            RAISE EXCEPTION 'Produto não encontrado ou inativo';
        END IF;

        -- Check variant override
        IF v_item.variant_id IS NOT NULL THEN
            SELECT price_override INTO v_variant_price_override FROM public.product_variants WHERE id = v_item.variant_id;
            v_item_price := COALESCE(v_variant_price_override, v_current_price);
        ELSE
            v_item_price := v_current_price;
        END IF;

        v_subtotal := v_subtotal + (v_item_price * v_item.quantity);
        
        -- Store calculating data for item insertion
        v_items_with_pricing := v_items_with_pricing || jsonb_build_object(
            'product_id', v_item.product_id,
            'variant_id', v_item.variant_id,
            'quantity', v_item.quantity,
            'price', v_item_price
        );
    END LOOP;

    -- 2. Validate Coupon and Calculate Discount
    IF p_coupon_code IS NOT NULL AND p_coupon_code <> '' THEN
        SELECT * INTO v_coupon_record FROM public.coupons WHERE code = p_coupon_code AND active = true;
        
        IF v_coupon_record.id IS NOT NULL THEN
            IF v_coupon_record.min_purchase IS NULL OR v_subtotal >= v_coupon_record.min_purchase THEN
                IF v_coupon_record.type = 'percentage' THEN
                    v_discount := (v_subtotal * v_coupon_record.value) / 100;
                ELSE
                    v_discount := v_coupon_record.value;
                END IF;
                
                -- Cap discount at subtotal
                IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
            END IF;
        END IF;
    END IF;

    v_total := v_subtotal + p_shipping - v_discount;

    -- 3. Insert Order
    INSERT INTO public.marketplace_orders (
        user_id, customer_name, customer_data, total, subtotal, 
        shipping, discount, payment_method, coupon_code, notes, status
    ) VALUES (
        p_user_id, p_customer_name, p_customer_data, v_total, v_subtotal,
        p_shipping, v_discount, p_payment_method, p_coupon_code, p_notes, 'new'
    ) RETURNING id INTO v_order_id;

    -- 4. Insert Items
    INSERT INTO public.marketplace_order_items (
        order_id, product_id, variant_id, product_name, quantity, price, image_url
    )
    SELECT 
        v_order_id, (x->>'product_id')::UUID, (x->>'variant_id')::UUID, 
        p.nome, (x->>'quantity')::INTEGER, (x->>'price')::NUMERIC, p.imagem_url
    FROM jsonb_array_elements(v_items_with_pricing) AS x
    JOIN public.produtos p ON p.id = (x->>'product_id')::UUID;

    -- 5. Notification & Coupon Increment
    INSERT INTO public.notificacoes (titulo, mensagem, tipo, dados, lida)
    VALUES ('Nova Venda Segura', 'Pedido #' || substring(v_order_id::text from 1 for 8) || ' validado pelo servidor.', 'sucesso', jsonb_build_object('pedido_id', v_order_id), false);

    IF p_coupon_code IS NOT NULL AND p_coupon_code <> '' THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE code = p_coupon_code;
    END IF;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Deprecate insecure RPC (Optional or Update hooks first)
-- For now we keep both but will point useOrders to v2.
