-- Solo-Ninja Final Security Hardening Batch 2026-03-17
-- Focus: RLS for Admin tables and RPC authorization checks

-- 1. Hardening RLS for Banners
DROP POLICY IF EXISTS "Authenticated Insert Banners" ON public.banners;
DROP POLICY IF EXISTS "Authenticated Update Banners" ON public.banners;
DROP POLICY IF EXISTS "Authenticated Delete Banners" ON public.banners;

CREATE POLICY "admin_insert_banners" ON public.banners FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_banners" ON public.banners FOR UPDATE USING (public.is_admin());
CREATE POLICY "admin_delete_banners" ON public.banners FOR DELETE USING (public.is_admin());

-- 2. Hardening RLS for Coupons
DROP POLICY IF EXISTS "Authenticated Insert Coupons" ON public.coupons;
DROP POLICY IF EXISTS "Authenticated Update Coupons" ON public.coupons;
DROP POLICY IF EXISTS "Authenticated Delete Coupons" ON public.coupons;

CREATE POLICY "admin_insert_coupons" ON public.coupons FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_coupons" ON public.coupons FOR UPDATE USING (public.is_admin());
CREATE POLICY "admin_delete_coupons" ON public.coupons FOR DELETE USING (public.is_admin());

-- 3. Hardening RLS for Answers
DROP POLICY IF EXISTS "Authenticated users can answer" ON public.answers;
CREATE POLICY "admin_insert_answers" ON public.answers FOR INSERT WITH CHECK (public.is_admin());

-- 4. Hardening RPCs (SECURITY DEFINER bypasses RLS, so we need explicit checks)

-- Update Order Status
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Somente administradores podem alterar status de pedidos.';
    END IF;

    -- Get current status and user
    SELECT status, user_id INTO v_old_status, v_user_id FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;

    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Update Order
    UPDATE public.marketplace_orders 
    SET status = p_new_status, updated_at = NOW() 
    WHERE id = p_order_id;

    -- Log History
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, auth.uid());
END;
$function$;

-- Swap Banner Order
CREATE OR REPLACE FUNCTION public.swap_banner_order(banner_id_1 uuid, banner_id_2 uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    order_1 INTEGER;
    order_2 INTEGER;
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado.';
    END IF;

    SELECT "order" INTO order_1 FROM public.banners WHERE id = banner_id_1;
    SELECT "order" INTO order_2 FROM public.banners WHERE id = banner_id_2;

    UPDATE public.banners SET "order" = order_2 WHERE id = banner_id_1;
    UPDATE public.banners SET "order" = order_1 WHERE id = banner_id_2;
END;
$function$;

-- Inventory Health
CREATE OR REPLACE FUNCTION public.get_inventory_health()
 RETURNS TABLE(product_id uuid, product_name text, current_stock integer, sales_last_30d bigint, days_remaining numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado.';
    END IF;

    RETURN QUERY
    WITH product_sales AS (
        SELECT oi.product_id, SUM(oi.quantity) as total_qty
        FROM public.marketplace_order_items oi
        JOIN public.marketplace_orders o ON o.id = oi.order_id
        WHERE o.created_at >= NOW() - INTERVAL '30 days' AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY oi.product_id
    )
    SELECT 
        p.id as product_id,
        p.nome as product_name,
        p.estoque as current_stock,
        COALESCE(ps.total_qty, 0)::bigint as sales_last_30d,
        CASE 
            WHEN ps.total_qty IS NULL OR ps.total_qty = 0 THEN 999::numeric 
            ELSE (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) 
        END as days_remaining
    FROM public.produtos p
    LEFT JOIN product_sales ps ON ps.product_id = p.id
    WHERE p.estoque < 20 OR (ps.total_qty > 0 AND (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) < 7)
    ORDER BY days_remaining ASC;
END;
$function$;

-- Customer Intelligence (PII Protection)
CREATE OR REPLACE FUNCTION public.get_customer_intelligence()
 RETURNS TABLE(customer_id uuid, customer_name text, total_spent numeric, order_count bigint, last_order_at timestamp with time zone, ltv_score numeric, is_push_subscribed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Esta função contém dados sensíveis.';
    END IF;

    RETURN QUERY
    SELECT 
        p.id as customer_id,
        p.full_name as customer_name,
        COALESCE(SUM(o.total), 0)::numeric as total_spent,
        COUNT(o.id)::bigint as order_count,
        MAX(o.created_at) as last_order_at,
        (COALESCE(SUM(o.total), 0) * 0.7 + COUNT(o.id) * 0.3)::numeric as ltv_score,
        EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p.id) as is_push_subscribed
    FROM public.profiles p
    LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
    GROUP BY p.id, p.full_name
    ORDER BY ltv_score DESC
    LIMIT 20;
END;
$function$;

-- Retention Analytics
CREATE OR REPLACE FUNCTION public.get_retention_analytics()
 RETURNS TABLE(month text, total_customers bigint, returning_customers bigint, retention_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado.';
    END IF;

    RETURN QUERY
    WITH monthly_users AS (
        SELECT 
            TO_CHAR(created_at, 'YYYY-MM') as active_month,
            user_id
        FROM public.marketplace_orders
        WHERE status NOT IN ('cancelled')
        GROUP BY 1, 2
    ),
    retention AS (
        SELECT 
            curr.active_month,
            COUNT(DISTINCT curr.user_id)::bigint as total_users,
            COUNT(DISTINCT prev.user_id)::bigint as returning_users
        FROM monthly_users curr
        LEFT JOIN monthly_users prev ON curr.user_id = prev.user_id 
            AND prev.active_month = TO_CHAR(TO_DATE(curr.active_month, 'YYYY-MM') - INTERVAL '1 month', 'YYYY-MM')
        GROUP BY 1
    )
    SELECT 
        active_month,
        total_users,
        returning_users,
        ROUND((returning_users::NUMERIC / GREATEST(total_users, 1) * 100), 1) as retention_rate
    FROM retention
    ORDER BY active_month DESC;
END;
$function$;

-- Retention Rate
CREATE OR REPLACE FUNCTION public.get_retention_rate()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    total_customers bigint := 0;
    repeated_customers bigint := 0;
    retention_rate numeric := 0;
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado.';
    END IF;

    -- Check total unique customers who bought
    SELECT count(DISTINCT coalesce(user_id::text, customer_data->>'whatsapp'))
    INTO total_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    -- Check how many of those made more than 1 order
    IF total_customers > 0 THEN
        WITH order_counts AS (
            SELECT count(*) AS purchase_count
            FROM public.marketplace_orders
            WHERE status NOT IN ('cancelled', 'returned')
            GROUP BY coalesce(user_id::text, customer_data->>'whatsapp')
        )
        SELECT count(*)
        INTO repeated_customers
        FROM order_counts
        WHERE purchase_count > 1;

        retention_rate := (repeated_customers::numeric / total_customers::numeric) * 100.0;
    END IF;

    RETURN round(retention_rate, 1);
END;
$function$;

-- Coupon Stats
CREATE OR REPLACE FUNCTION public.get_coupon_stats()
 RETURNS TABLE(total_coupons bigint, active_coupons bigint, total_uses bigint, avg_discount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- SECURITY CHECK: Admin only
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado.';
    END IF;

    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        COUNT(*) FILTER (WHERE active = true)::BIGINT,
        COALESCE(SUM(usage_count), 0)::BIGINT,
        COALESCE(AVG(value), 0)::NUMERIC
    FROM public.coupons;
END;
$function$;

ANALYZE marketplace_orders;
ANALYZE coupons;
ANALYZE banners;
