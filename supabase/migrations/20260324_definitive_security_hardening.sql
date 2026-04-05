-- ==============================================================================
-- 🥷 SOLO-NINJA DEFINITIVE SECURITY HARDENING v25 (Consolidated)
-- ==============================================================================
-- Target: Critical RPCs and Table Policies (PII, BOLA, Privilege Escalation)
-- Special: Clean up overloaded functions to ensure security patches are active.

BEGIN;

-- 0. CLEANUP OLD OVERLOADED FUNCTIONS (Crucial to avoid hitting insecure versions)
DROP FUNCTION IF EXISTS public.update_order_status_atomic(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_segmented_push_targets(text, numeric, integer);
DROP FUNCTION IF EXISTS public.get_coupon_stats();
DROP FUNCTION IF EXISTS public.swap_banner_order(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_inventory_health();
DROP FUNCTION IF EXISTS public.get_customer_intelligence();
DROP FUNCTION IF EXISTS public.get_retention_analytics();
DROP FUNCTION IF EXISTS public.get_retention_rate();

-- 1. ENSURE is_admin() HELPER
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$;

-- 2. HARDEN STORE CONFIG
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  INSERT INTO public.store_config (
    id, free_shipping_min, shipping_fee, whatsapp_number, share_text, 
    business_hours, enable_reviews, enable_coupons, primary_color, 
    theme_mode, logo_url, real_time_sales_alerts, push_marketing_enabled, 
    min_app_version
  )
  VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 100),
    COALESCE((config_json->>'shipping_fee')::numeric, 15),
    COALESCE(config_json->>'whatsapp_number', '5534999999999'),
    COALESCE(config_json->>'share_text', 'Confira os produtos!'),
    COALESCE(config_json->>'business_hours', 'Seg-Sáb: 9h às 18h'),
    COALESCE((config_json->>'enable_reviews')::boolean, true),
    COALESCE((config_json->>'enable_coupons')::boolean, true),
    COALESCE(config_json->>'primary_color', '#000000'),
    COALESCE(config_json->>'theme_mode', 'light'),
    config_json->>'logo_url',
    COALESCE((config_json->>'real_time_sales_alerts')::boolean, true),
    COALESCE((config_json->>'push_marketing_enabled')::boolean, false),
    config_json->>'min_app_version'
  )
  ON CONFLICT (id) DO UPDATE SET
    free_shipping_min = EXCLUDED.free_shipping_min,
    shipping_fee = EXCLUDED.shipping_fee,
    whatsapp_number = EXCLUDED.whatsapp_number,
    share_text = EXCLUDED.share_text,
    business_hours = EXCLUDED.business_hours,
    enable_reviews = EXCLUDED.enable_reviews,
    enable_coupons = EXCLUDED.enable_coupons,
    primary_color = EXCLUDED.primary_color,
    theme_mode = EXCLUDED.theme_mode,
    logo_url = EXCLUDED.logo_url,
    real_time_sales_alerts = EXCLUDED.real_time_sales_alerts,
    push_marketing_enabled = EXCLUDED.push_marketing_enabled,
    min_app_version = EXCLUDED.min_app_version,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

-- 3. HARDEN ORDER STATUS (BOLA)
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(
    p_order_id uuid, 
    p_new_status text, 
    p_notes text DEFAULT NULL, 
    p_silent boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_is_admin BOOLEAN := public.is_admin();
BEGIN
    SELECT status, user_id INTO v_old_status, v_user_id 
    FROM public.marketplace_orders 
    WHERE id = p_order_id 
    FOR UPDATE;
    
    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF v_user_id != v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Não autorizado: Você não tem permissão para alterar este pedido.';
    END IF;

    IF NOT v_is_admin THEN
        IF p_new_status != 'cancelled' THEN
            RAISE EXCEPTION 'Operação não permitida: Usuários só podem cancelar seus próprios pedidos.';
        END IF;
        IF v_old_status != 'pending' THEN
            RAISE EXCEPTION 'Apenas pedidos pendentes podem ser cancelados pelo usuário.';
        END IF;
    END IF;

    UPDATE public.marketplace_orders 
    SET status = p_new_status, updated_at = NOW() 
    WHERE id = p_order_id;

    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, v_caller_id);
END;
$$;

-- 4. HARDEN ANALYTICS
CREATE OR REPLACE FUNCTION public.get_customer_intelligence()
 RETURNS TABLE(customer_id uuid, customer_name text, total_spent numeric, order_count bigint, last_order_at timestamp with time zone, ltv_score numeric, is_push_subscribed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: Dados sensíveis.';
    END IF;

    RETURN QUERY
    SELECT 
        p.id as customer_id,
        p.full_name as customer_name,
        COALESCE(SUM(o.total_amount), 0)::numeric as total_spent,
        COUNT(o.id) as order_count,
        MAX(o.created_at) as last_order_at,
        (COALESCE(SUM(o.total_amount), 0) * 0.7 + COUNT(o.id) * 0.3)::numeric as ltv_score,
        EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p.id) as is_push_subscribed
    FROM public.profiles p
    LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
    GROUP BY p.id, p.full_name
    ORDER BY ltv_score DESC
    LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_retention_analytics()
 RETURNS TABLE(month text, total_customers bigint, returning_customers bigint, retention_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado.';
    END IF;

    RETURN QUERY
    WITH monthly_users AS (
        SELECT TO_CHAR(created_at, 'YYYY-MM') as active_month, user_id
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
    SELECT active_month, total_users, returning_users, ROUND((returning_users::NUMERIC / GREATEST(total_users, 1) * 100), 1) as retention_rate
    FROM retention
    ORDER BY active_month DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_retention_rate()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
    total_customers bigint := 0;
    repeated_customers bigint := 0;
    retention_rate numeric := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado.';
    END IF;

    SELECT count(DISTINCT user_id) INTO total_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    IF total_customers > 0 THEN
        WITH order_counts AS (
            SELECT count(*) AS purchase_count FROM public.marketplace_orders
            WHERE status NOT IN ('cancelled', 'returned') GROUP BY user_id
        )
        SELECT count(*) INTO repeated_customers FROM order_counts WHERE purchase_count > 1;
        retention_rate := (repeated_customers::numeric / total_customers::numeric) * 100.0;
    END IF;

    RETURN round(retention_rate, 1);
END;
$$;

-- 5. HARDEN SECURITY UTILS
CREATE OR REPLACE FUNCTION public.get_coupon_stats()
 RETURNS TABLE(total_coupons bigint, active_coupons bigint, total_uses bigint, avg_discount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        COUNT(*) FILTER (WHERE active = true)::BIGINT,
        COALESCE(SUM(usage_count), 0)::BIGINT,
        COALESCE(AVG(value), 0)::NUMERIC
    FROM public.coupons;
END;
$$;

CREATE OR REPLACE FUNCTION public.swap_banner_order(banner_id_1 uuid, banner_id_2 uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
    order_1 INTEGER; order_2 INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;
    SELECT "order" INTO order_1 FROM public.banners WHERE id = banner_id_1;
    SELECT "order" INTO order_2 FROM public.banners WHERE id = banner_id_2;
    IF order_1 IS NULL OR order_2 IS NULL THEN RAISE EXCEPTION 'Banner não encontrado.'; END IF;
    UPDATE public.banners SET "order" = order_2 WHERE id = banner_id_1;
    UPDATE public.banners SET "order" = order_1 WHERE id = banner_id_2;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inventory_health()
 RETURNS TABLE(product_id uuid, product_name text, current_stock integer, sales_last_30d bigint, days_remaining numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
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
        p.id as product_id, p.nome as product_name, p.estoque as current_stock,
        COALESCE(ps.total_qty, 0) as sales_last_30d,
        CASE WHEN ps.total_qty IS NULL OR ps.total_qty = 0 THEN 999 ELSE (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) END as days_remaining
    FROM public.produtos p
    LEFT JOIN product_sales ps ON ps.product_id = p.id
    WHERE p.estoque < 20 OR (ps.total_qty > 0 AND (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) < 7)
    ORDER BY days_remaining ASC;
END;
$$;

COMMIT;
