-- 20260303_consolidated_remediation_v3.sql
-- Unified Security Hardening Patch
-- Objective: Define missing RPCs (v3/v2) with robust server-side validation and consolidate role protection.

-- 1. Ensure is_admin() helper
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Secure Coupon Validation
-- Required by useCoupons.ts
DROP FUNCTION IF EXISTS public.validate_coupon_secure(text, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.validate_coupon_secure() CASCADE;
CREATE OR REPLACE FUNCTION public.validate_coupon_secure(p_code TEXT, p_subtotal NUMERIC)
RETURNS JSONB AS $$
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
    ELSIF v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_count >= v_coupon.usage_limit THEN
        v_error := 'Cupom atingiu o limite de uso.';
    ELSIF v_coupon.min_purchase IS NOT NULL AND p_subtotal < v_coupon.min_purchase THEN
        v_error := 'Valor mínimo não atingido (' || v_coupon.min_purchase || ').';
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

    RETURN jsonb_build_array(jsonb_build_object(
        'is_valid', v_is_valid,
        'discount_value', v_discount,
        'error_message', v_error
    ));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Hardened Admin Analytics
-- Required by useOrders.ts
DROP FUNCTION IF EXISTS public.get_admin_analytics_v2() CASCADE;
CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2()
RETURNS JSONB AS $$
DECLARE
    v_today_start TIMESTAMP := CURRENT_DATE::TIMESTAMP;
    v_month_start TIMESTAMP := DATE_TRUNC('month', CURRENT_DATE);
    v_month_prev_start TIMESTAMP := v_month_start - INTERVAL '1 month';
    v_result JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Requer privilégios de administrador.';
    END IF;

    WITH stats_today AS (
        SELECT 
            COALESCE(SUM(total), 0) as revenue,
            COUNT(*) as count,
            COUNT(*) FILTER (WHERE status = 'new') as pending
        FROM public.marketplace_orders
        WHERE created_at >= v_today_start
    ),
    stats_month AS (
        SELECT 
            COALESCE(SUM(total), 0) as revenue,
            COUNT(*) as count
        FROM public.marketplace_orders
        WHERE created_at >= v_month_start
    ),
    revenue_history AS (
        SELECT 
            TO_CHAR(day, 'DD/MM') as date,
            TO_CHAR(day, 'YYYY-MM-DD') as full_date,
            COALESCE(SUM(o.total), 0) as revenue,
            COUNT(o.id) as orders
        FROM GENERATE_SERIES(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') day
        LEFT JOIN public.marketplace_orders o ON DATE_TRUNC('day', o.created_at) = day
        GROUP BY 1, 2 ORDER BY 2
    ),
    top_products AS (
        SELECT 
            oi.product_id,
            p.nome as name,
            SUM(oi.quantity) as quantity,
            SUM(oi.price * oi.quantity) as total,
            p.imagem_url as image
        FROM public.marketplace_order_items oi
        JOIN public.produtos p ON p.id = oi.product_id
        GROUP BY 1, 2, 5
        ORDER BY 3 DESC LIMIT 5
    )
    SELECT jsonb_build_object(
        'today', (SELECT jsonb_build_object('revenue', revenue, 'count', count, 'pending', pending) FROM stats_today),
        'month', (SELECT jsonb_build_object('revenue', revenue, 'count', count) FROM stats_month),
        'averageTicket', (SELECT CASE WHEN count > 0 THEN revenue / count ELSE 0 END FROM stats_month),
        'revenueHistory', (SELECT jsonb_agg(row_to_json(rh)) FROM revenue_history rh),
        'topProducts', (SELECT jsonb_agg(row_to_json(tp)) FROM top_products tp)
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Unified Marketplace Order Creation v3
-- Required by useOrders.ts
-- Consolidates all security fixes: Price calculation, Shipping from config, Coupon validation, RLS protection.
DROP FUNCTION IF EXISTS public.create_marketplace_order_v3(jsonb, text, uuid, text, text, text, text, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.create_marketplace_order_v3() CASCADE;
CREATE OR REPLACE FUNCTION public.create_marketplace_order_v3(
    p_items JSONB,
    p_payment_method TEXT,
    p_address_id UUID,
    p_coupon_code TEXT,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_notes TEXT,
    p_user_id UUID DEFAULT NULL
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
    v_shipping NUMERIC := 0;
    v_config RECORD;
    v_coupon_record RECORD;
    v_item_price NUMERIC;
    v_items_with_pricing JSONB := '[]'::JSONB;
BEGIN
    -- 0. Fetch Store Config for Shipping logic
    SELECT * INTO v_config FROM public.store_config WHERE id = 1;
    v_shipping := COALESCE(v_config.shipping_fee, 0);

    -- 1. Validate and Calculate Prices
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, variant_id UUID, quantity INTEGER)
    LOOP
        IF v_item.quantity <= 0 THEN RAISE EXCEPTION 'Quantidade deve ser positiva.'; END IF;
        IF v_item.quantity > 500 THEN RAISE EXCEPTION 'Quantidade excede o limite (500).'; END IF;

        SELECT preco_venda INTO v_current_price FROM public.produtos WHERE id = v_item.product_id;
        IF v_current_price IS NULL THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;

        IF v_item.variant_id IS NOT NULL THEN
            SELECT price_override INTO v_variant_price_override FROM public.product_variants WHERE id = v_item.variant_id;
            v_item_price := COALESCE(v_variant_price_override, v_current_price);
        ELSE
            v_item_price := v_current_price;
        END IF;

        v_subtotal := v_subtotal + (v_item_price * v_item.quantity);
        
        v_items_with_pricing := v_items_with_pricing || jsonb_build_object(
            'product_id', v_item.product_id,
            'variant_id', v_item.variant_id,
            'quantity', v_item.quantity,
            'price', v_item_price
        );
    END LOOP;

    -- 2. Shipping Logic (Server-side)
    IF v_config.free_shipping_min IS NOT NULL AND v_subtotal >= v_config.free_shipping_min THEN
        v_shipping := 0;
    END IF;

    -- 3. Validate Coupon
    IF p_coupon_code IS NOT NULL AND p_coupon_code <> '' THEN
        SELECT * INTO v_coupon_record FROM public.coupons WHERE code = p_coupon_code AND active = true;
        
        IF v_coupon_record.id IS NOT NULL THEN
            IF v_coupon_record.valid_until IS NULL OR v_coupon_record.valid_until >= NOW() THEN
                IF v_coupon_record.usage_limit IS NULL OR v_coupon_record.usage_count < v_coupon_record.usage_limit THEN
                    IF v_coupon_record.min_purchase IS NULL OR v_subtotal >= v_coupon_record.min_purchase THEN
                        IF v_coupon_record.type = 'percentage' THEN
                            v_discount := (v_subtotal * v_coupon_record.value) / 100;
                        ELSE
                            v_discount := v_coupon_record.value;
                        END IF;
                        IF v_discount > v_subtotal THEN v_discount := v_subtotal; END IF;
                    END IF;
                END IF;
            END IF;
        END IF;
    END IF;

    v_total := v_subtotal + v_shipping - v_discount;

    -- 4. Insert Order
    INSERT INTO public.marketplace_orders (
        user_id, customer_name, customer_data, total, subtotal, 
        shipping, discount, payment_method, coupon_code, notes, status
    ) VALUES (
        COALESCE(p_user_id, auth.uid()), p_customer_name, 
        jsonb_build_object('whatsapp', p_customer_phone, 'address_id', p_address_id), 
        v_total, v_subtotal, v_shipping, v_discount, p_payment_method, p_coupon_code, p_notes, 'new'
    ) RETURNING id INTO v_order_id;

    -- 5. Insert Items
    INSERT INTO public.marketplace_order_items (
        order_id, product_id, variant_id, product_name, quantity, price, image_url
    )
    SELECT 
        v_order_id, (x->>'product_id')::UUID, (x->>'variant_id')::UUID, 
        p.nome, (x->>'quantity')::INTEGER, (x->>'price')::NUMERIC, p.imagem_url
    FROM jsonb_array_elements(v_items_with_pricing) AS x
    JOIN public.produtos p ON p.id = (x->>'product_id')::UUID;

    -- 6. Coupon usage increment
    IF v_discount > 0 THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE code = p_coupon_code;
    END IF;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Role Protection Trigger
CREATE OR REPLACE FUNCTION public.ensure_role_protection()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent role changes unless the executor is an admin
    IF (OLD.role <> NEW.role) AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        NEW.role = OLD.role;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_ensure_role_protection ON public.profiles;
CREATE TRIGGER tr_ensure_role_protection
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.ensure_role_protection();
