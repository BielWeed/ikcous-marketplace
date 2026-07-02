-- 20260326_fix_order_schema_and_rpc.sql
-- Goal: Align marketplace_orders schema with create_marketplace_order_v21 RPC

BEGIN;

-- 1. Add missing columns to marketplace_orders
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marketplace_orders' AND column_name='address_id') THEN
        ALTER TABLE public.marketplace_orders ADD COLUMN address_id UUID;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marketplace_orders' AND column_name='coupon_id') THEN
        ALTER TABLE public.marketplace_orders ADD COLUMN coupon_id UUID REFERENCES public.coupons(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='marketplace_orders' AND column_name='tracking_code') THEN
        ALTER TABLE public.marketplace_orders ADD COLUMN tracking_code TEXT;
    END IF;
END $$;

-- 2. Update create_marketplace_order_v21 to use correct column names
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

    -- Capture full address snapshot for the order
    IF p_address_id IS NOT NULL THEN
        SELECT jsonb_build_object(
            'whatsapp', p_customer_phone,
            'address', row_to_json(ua)::jsonb
        ) INTO v_item -- reuse v_item as temp jsonb
        FROM public.user_addresses ua
        WHERE id = p_address_id;
    ELSE
        v_item := jsonb_build_object('whatsapp', p_customer_phone);
    END IF;
 
    INSERT INTO public.marketplace_orders (
        user_id, total, shipping, payment_method, address_id, 
        coupon_id, status, notes, customer_name, customer_data,
        subtotal, discount, coupon_code
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id, 
        v_coupon_id, 'pending', p_observation, p_customer_name,
        v_item,
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

-- 3. Update get_admin_analytics_v2
CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today_start TIMESTAMP := CURRENT_DATE::TIMESTAMP;
    v_month_start TIMESTAMP := DATE_TRUNC('month', CURRENT_DATE);
    v_result JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Requer privilégios de administrador.';
    END IF;

    WITH stats_today AS (
        SELECT 
            COALESCE(SUM(total), 0) as revenue,
            COUNT(*) as count,
            COUNT(*) FILTER (WHERE status = 'pending') as pending
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
$$;

COMMIT;
