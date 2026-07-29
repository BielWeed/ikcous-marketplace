-- Migration: Database Deep Cleanup and Optimization
-- Date: 2026-07-08
-- Version: 20260708150000

BEGIN;

-- ============================================================================
-- 1. MOVE EXTENSIONS TO DESIGNATED SCHEMA (Resolves extension_in_public)
-- ============================================================================
DROP EXTENSION IF EXISTS pg_net CASCADE;
CREATE EXTENSION pg_net WITH SCHEMA extensions;


-- ============================================================================
-- 2. CREATE RLS POLICIES FOR TABLES WITHOUT POLICIES (Resolves rls_enabled_no_policy)
-- ============================================================================

-- Table: public._ninja_migrations
DROP POLICY IF EXISTS "Admins full access on _ninja_migrations" ON public._ninja_migrations;
CREATE POLICY "Admins full access on _ninja_migrations" ON public._ninja_migrations
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

-- Table: public.app_settings
DROP POLICY IF EXISTS "Admins legacy access on app_settings" ON public.app_settings;
CREATE POLICY "Admins legacy access on app_settings" ON public.app_settings
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

-- Table: public.otp_verifications
DROP POLICY IF EXISTS "Admins full access on otp_verifications" ON public.otp_verifications;
CREATE POLICY "Admins full access on otp_verifications" ON public.otp_verifications
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

-- Table: public.shipping_quotes_cache
DROP POLICY IF EXISTS "Admins have full access to shipping_quotes_cache" ON public.shipping_quotes_cache;
CREATE POLICY "Admins have full access to shipping_quotes_cache" ON public.shipping_quotes_cache
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- ============================================================================
-- 3. HARDEN ANALYTICS EVENTS RLS POLICY (Resolves permissive_rls_policy)
-- ============================================================================
DROP POLICY IF EXISTS analytics_events_insert_policy ON public.analytics_events;
CREATE POLICY analytics_events_insert_policy ON public.analytics_events
FOR INSERT TO public WITH CHECK (
    (auth.uid() IS NULL AND user_id IS NULL)
    OR (auth.uid() = user_id)
);


-- ============================================================================
-- 4. AUTOMATIC CLEANUP & PERFORMANCE INDEXES FOR CACHE/LOGS/OTPS
-- ============================================================================

-- Index for cache expirations
CREATE INDEX IF NOT EXISTS idx_shipping_quotes_cache_created_at
ON public.shipping_quotes_cache (created_at);

-- Cache cleanup function
CREATE OR REPLACE FUNCTION public.clean_expired_shipping_quotes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.shipping_quotes_cache
    WHERE created_at < NOW() - INTERVAL '24 hours';
    RETURN NEW;
END;
$$;

-- Cache cleanup trigger (statement-level)
DROP TRIGGER IF EXISTS trigger_clean_expired_shipping_quotes ON public.shipping_quotes_cache;
CREATE TRIGGER trigger_clean_expired_shipping_quotes
AFTER INSERT ON public.shipping_quotes_cache
FOR EACH STATEMENT
EXECUTE FUNCTION public.clean_expired_shipping_quotes();

-- Shipping logs cleanup function
CREATE OR REPLACE FUNCTION public.clean_old_shipping_logs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.shipping_calculation_logs
    WHERE created_at < NOW() - INTERVAL '30 days';
    RETURN NEW;
END;
$$;

-- Shipping logs cleanup trigger (statement-level)
DROP TRIGGER IF EXISTS trigger_clean_old_shipping_logs ON public.shipping_calculation_logs;
CREATE TRIGGER trigger_clean_old_shipping_logs
AFTER INSERT ON public.shipping_calculation_logs
FOR EACH STATEMENT
EXECUTE FUNCTION public.clean_old_shipping_logs();

-- OTP Index for expirations
CREATE INDEX IF NOT EXISTS idx_otp_verifications_expires_at
ON public.otp_verifications (expires_at);

-- Recreate generate_order_otp_v1 to perform cleanup before insertion
CREATE OR REPLACE FUNCTION public.generate_order_otp_v1(
    p_email TEXT, p_whatsapp TEXT, p_order_fragment TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_otp TEXT;
    v_exists BOOLEAN;
BEGIN
    -- [CLEANUP] Exclude expired OTP records
    DELETE FROM public.otp_verifications WHERE expires_at < NOW();

    -- Validate if a matching order exists
    -- p_order_fragment should match the END of an order ID for this email/whatsapp
    -- Using ILIKE for case-insensitive and matching the end
    SELECT EXISTS (
        SELECT 1 FROM public.marketplace_orders o
        LEFT JOIN auth.users u ON u.id = o.user_id
        WHERE (
            -- WhatsApp comparison immune to formatting (extracting only digits)
            (p_whatsapp IS NOT NULL AND p_whatsapp <> '' AND 
             regexp_replace(coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''), '[^0-9]', '', 'g') = regexp_replace(p_whatsapp, '[^0-9]', '', 'g'))
            OR
            -- Email comparison (either on customer_data or logged-in user email)
            (p_email IS NOT NULL AND p_email <> '' AND 
             (LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(p_email) 
              OR LOWER(coalesce(u.email, '')) = LOWER(p_email)))
        )
        AND o.id::text ILIKE '%' || p_order_fragment
    ) INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'Dados do pedido não encontrados.';
    END IF;

    -- Generate a 6-digit OTP
    v_otp := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

    -- Insert into verifications table
    INSERT INTO public.otp_verifications (email, whatsapp, otp_code, expires_at)
    VALUES (p_email, p_whatsapp, v_otp, NOW() + INTERVAL '15 minutes');

    RETURN v_otp;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_order_otp_v1(
    TEXT, TEXT, TEXT
) TO anon,
authenticated,
service_role;


-- ============================================================================
-- 5. OPTIMIZE DASHBOARD ANALYTICS & QUERY SPEED (Index, View and RPC)
-- ============================================================================

-- Create expression index for date truncations (using AT TIME ZONE for immutability)
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_created_at_date
ON public.marketplace_orders (((created_at AT TIME ZONE 'UTC')::DATE));

-- Recreate sales_overview view using expression-index compatible casting
DROP VIEW IF EXISTS public.sales_overview CASCADE;
CREATE OR REPLACE VIEW public.sales_overview WITH (security_invoker = on) AS
SELECT
    (created_at AT TIME ZONE 'UTC')::DATE AS sales_day,
    count(id) AS total_orders,
    sum(total) AS gross_revenue,
    avg(total) AS average_ticket,
    sum(
        CASE
            WHEN (status = 'completed'::TEXT) THEN total
            ELSE (0)::NUMERIC
        END
    ) AS net_revenue
FROM public.marketplace_orders
GROUP BY ((created_at AT TIME ZONE 'UTC')::DATE)
ORDER BY ((created_at AT TIME ZONE 'UTC')::DATE) DESC;

GRANT SELECT ON public.sales_overview TO authenticated, service_role;

-- Drop function to recreate with parameter signature change
DROP FUNCTION IF EXISTS public.get_admin_analytics_v2();

-- Recreate get_admin_analytics_v2 with p_limit_days parameter
CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(
    p_limit_days INTEGER DEFAULT 90
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    result json;
    active_users_count int;
    low_stock_count int;
    
    -- Today stats
    today_revenue numeric;
    today_count bigint;
    today_pending bigint;
    yesterday_revenue numeric;
    yesterday_count bigint;
    today_rev_trend numeric;
    today_count_trend numeric;
    
    -- month stats (rolling 30 days)
    month_revenue numeric;
    month_count bigint;
    prev_month_revenue numeric;
    prev_month_count bigint;
    month_rev_trend numeric;
    month_count_trend numeric;
    
    -- executive stats (all-time)
    total_rev numeric;
    total_ord bigint;
    
    -- avg ticket (all-time)
    avg_ticket numeric;
    
    -- active customers (all-time)
    active_customers bigint;
    
    -- inventory values
    inv_cost_total numeric;
    inv_value_total numeric;
    
    -- lists
    rev_history json;
    top_prods json;
BEGIN
    -- 0. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Today vs Yesterday (Same period)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now())
    AND status NOT IN ('cancelled', 'returned');

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO yesterday_revenue, yesterday_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now() - interval '1 day')
    AND created_at < now() - interval '1 day'
    AND status NOT IN ('cancelled', 'returned');

    today_rev_trend := CASE WHEN yesterday_revenue > 0 THEN ((today_revenue - yesterday_revenue) / yesterday_revenue) * 100 ELSE (CASE WHEN today_revenue > 0 THEN 100 ELSE 0 END) END;
    today_count_trend := CASE WHEN yesterday_count > 0 THEN ((today_count::numeric - yesterday_count::numeric) / yesterday_count::numeric) * 100 ELSE (CASE WHEN today_count > 0 THEN 100 ELSE 0 END) END;

    SELECT COUNT(*) INTO today_pending
    FROM public.marketplace_orders
    WHERE status in ('pending', 'new', 'processing');

    -- 2. month vs Previous Month (Rolling 30 Days)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO month_revenue, month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned');

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO prev_month_revenue, prev_month_count
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned');

    month_rev_trend := CASE WHEN prev_month_revenue > 0 THEN ((month_revenue - prev_month_revenue) / prev_month_revenue) * 100 ELSE (CASE WHEN month_revenue > 0 THEN 100 ELSE 0 END) END;
    month_count_trend := CASE WHEN prev_month_count > 0 THEN ((month_count::numeric - prev_month_count::numeric) / prev_month_count::numeric) * 100 ELSE (CASE WHEN month_count > 0 THEN 100 ELSE 0 END) END;

    -- 3. Executive Metrics (All-time total metrics)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_rev, total_ord
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    avg_ticket := CASE WHEN total_ord > 0 THEN total_rev / total_ord ELSE 0 END;

    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO active_customers
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    SELECT COUNT(*) INTO active_users_count FROM public.profiles;

    SELECT COUNT(*) INTO low_stock_count 
    FROM public.produtos 
    WHERE estoque <= COALESCE(estoque_minimo, 5) AND ativo = true AND deleted_at IS NULL;

    -- Compute current total inventory cost and value
    SELECT 
        COALESCE(SUM(custo * estoque), 0),
        COALESCE(SUM(preco_venda * estoque), 0)
    INTO inv_cost_total, inv_value_total
    FROM public.produtos
    WHERE deleted_at IS NULL AND ativo = true;

    -- 4. Revenue, Orders, Profit & Cost History (Filtered by p_limit_days for performance)
    -- This scans only within the required range using the created_at index or created_at::date expression index
    SELECT json_agg(h)
    INTO rev_history
    FROM (
        WITH days AS (
            SELECT generate_series(
                (now() - (p_limit_days || ' days')::interval)::date,
                now()::date,
                interval '1 day'
            )::date AS day
        ),
        daily_orders AS (
            SELECT 
                (o.created_at AT TIME ZONE 'UTC')::date AS day,
                COALESCE(SUM(o.total), 0) AS revenue,
                COUNT(o.id)::int as orders
            FROM public.marketplace_orders o
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
            GROUP BY ((o.created_at AT TIME ZONE 'UTC')::date)
        ),
        daily_items AS (
            SELECT 
                (o.created_at AT TIME ZONE 'UTC')::date AS day,
                COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0))), 0) AS profit,
                COALESCE(SUM(oi.quantity * COALESCE(p.custo, 0)), 0) AS cost_sold
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON oi.order_id = o.id
            LEFT JOIN public.produtos p ON oi.product_id = p.id
            WHERE o.created_at >= now() - (p_limit_days || ' days')::interval - interval '1 day'
              AND o.status NOT IN ('cancelled', 'returned')
            GROUP BY ((o.created_at AT TIME ZONE 'UTC')::date)
        )
        SELECT 
            TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
            TO_CHAR(d.day, 'DD/MM') AS full_date,
            COALESCE(dor.revenue, 0) AS revenue,
            COALESCE(dor.orders, 0) AS orders,
            COALESCE(dit.profit, 0) AS profit,
            COALESCE(dit.cost_sold, 0) AS cost_sold
        FROM days d
        LEFT JOIN daily_orders dor ON d.day = dor.day
        LEFT JOIN daily_items dit ON d.day = dit.day
        ORDER BY d.day ASC
    ) h;

    -- 5. Top Products (All time)
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        SELECT 
            p.id as id,
            p.nome AS name,
            SUM(oi.quantity)::int as quantity,
            SUM(oi.quantity * oi.price) as total,
            COALESCE(p.imagem_url, '') as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        AND p.deleted_at IS NULL
        GROUP BY p.id, p.nome, p.imagem_url
        ORDER BY total DESC
        LIMIT 5
    ) p;

    -- BUILD FINAL OBJECT (Matching DashboardStats interface 100%)
    result := json_build_object(
        'today', json_build_object(
            'revenue', today_revenue, 
            'count', today_count, 
            'pending', today_pending,
            'revenueTrend', round(today_rev_trend, 1),
            'countTrend', round(today_count_trend, 1)
        ),
        'month', json_build_object(
            'revenue', month_revenue, 
            'count', month_count,
            'revenueTrend', round(month_rev_trend, 1),
            'countTrend', round(month_count_trend, 1)
        ),
        'executive', json_build_object(
            'totalRevenue', total_rev,
            'totalOrders', total_ord,
            'revenueTrend', 0,
            'ordersTrend', 0,
            'avgTicket', round(avg_ticket, 2),
            'avgTicketTrend', 0,
            'activeCustomers', active_customers,
            'activeCustomersTrend', 0
        ),
        'revenueHistory', COALESCE(rev_history, '[]'::json),
        'topProducts', COALESCE(top_prods, '[]'::json),
        'inventoryAlerts', low_stock_count,
        'growth', round(month_rev_trend, 1),
        'inventory', json_build_object(
            'totalCost', inv_cost_total,
            'totalValue', inv_value_total
        ),
        'averageTicket', round(avg_ticket, 2)
    );

    RETURN result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_admin_analytics_v2(
    INTEGER
) TO authenticated,
service_role;


-- ============================================================================
-- 6. REMOVE REDUNDANT ROLE PROTECTION TRIGGER ON profiles
-- ============================================================================
DROP TRIGGER IF EXISTS tr_ensure_role_protection ON public.profiles;
DROP FUNCTION IF EXISTS public.ensure_role_protection();

COMMIT;
