-- 20260601_fix_dashboard_analytics_regression.sql
-- Goal: Fix empty dashboard and frontend crashes due to:
-- 1. Wrong status filters (only completed/paid/delivered counted, but dev orders use pending/processing/shipping).
-- 2. Mismatched field names (nome instead of name, missing orders and countTrend/avgTicket fields).
-- 3. Null values in total_amount (using total column instead).

BEGIN;

DROP FUNCTION IF EXISTS public.get_admin_analytics_v2() CASCADE;

CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    
    -- month stats
    month_revenue numeric;
    month_count bigint;
    prev_month_revenue numeric;
    prev_month_count bigint;
    month_rev_trend numeric;
    month_count_trend numeric;
    
    -- executive stats (30 days)
    rev_30d numeric;
    count_30d bigint;
    prev_rev_30d numeric;
    prev_count_30d bigint;
    rev_30d_trend numeric;
    count_30d_trend numeric;
    
    -- avg ticket (30 days)
    avg_ticket_30d numeric;
    prev_avg_ticket_30d numeric;
    avg_ticket_trend numeric;
    
    -- active customers (30 days)
    active_customers_30d bigint;
    prev_active_customers_30d bigint;
    active_customers_trend numeric;
    
    -- total metrics
    total_rev numeric;
    total_ord bigint;
    
    -- lists
    rev_history json;
    top_prods json;
BEGIN
    -- 0. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Today vs Yesterday (Same period)
    -- Current day so far
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now())
    AND status NOT IN ('cancelled', 'returned');

    -- Yesterday same period (up to current hour/minute)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO yesterday_revenue, yesterday_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now() - interval '1 day')
    AND created_at < now() - interval '1 day'
    AND status NOT IN ('cancelled', 'returned');

    -- Trends
    today_rev_trend := CASE WHEN yesterday_revenue > 0 THEN ((today_revenue - yesterday_revenue) / yesterday_revenue) * 100 ELSE (CASE WHEN today_revenue > 0 THEN 100 ELSE 0 END) END;
    today_count_trend := CASE WHEN yesterday_count > 0 THEN ((today_count::numeric - yesterday_count::numeric) / yesterday_count::numeric) * 100 ELSE (CASE WHEN today_count > 0 THEN 100 ELSE 0 END) END;

    -- Pending
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

    -- 3. Executive Metrics (Last 30 Days vs Previous 30 Days)
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO rev_30d, count_30d
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned');

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO prev_rev_30d, prev_count_30d
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned');

    rev_30d_trend := CASE WHEN prev_rev_30d > 0 THEN ((rev_30d - prev_rev_30d) / prev_rev_30d) * 100 ELSE (CASE WHEN rev_30d > 0 THEN 100 ELSE 0 END) END;
    count_30d_trend := CASE WHEN prev_count_30d > 0 THEN ((count_30d::numeric - prev_count_30d::numeric) / prev_count_30d::numeric) * 100 ELSE (CASE WHEN count_30d > 0 THEN 100 ELSE 0 END) END;

    -- Avg Ticket 30d
    avg_ticket_30d := CASE WHEN count_30d > 0 THEN rev_30d / count_30d ELSE 0 END;
    prev_avg_ticket_30d := CASE WHEN prev_count_30d > 0 THEN prev_rev_30d / prev_count_30d ELSE 0 END;
    avg_ticket_trend := CASE WHEN prev_avg_ticket_30d > 0 THEN ((avg_ticket_30d - prev_avg_ticket_30d) / prev_avg_ticket_30d) * 100 ELSE (CASE WHEN avg_ticket_30d > 0 THEN 100 ELSE 0 END) END;

    -- Active Customers (Unique Users with at least 1 order in 30d)
    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO active_customers_30d
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned');

    SELECT COUNT(DISTINCT COALESCE(user_id::text, customer_data->>'email', customer_data->>'whatsapp'))
    INTO prev_active_customers_30d
    FROM public.marketplace_orders
    WHERE created_at >= now() - interval '60 days'
    AND created_at < now() - interval '30 days'
    AND status NOT IN ('cancelled', 'returned');

    active_customers_trend := CASE WHEN prev_active_customers_30d > 0 THEN ((active_customers_30d::numeric - prev_active_customers_30d::numeric) / prev_active_customers_30d::numeric) * 100 ELSE (CASE WHEN active_customers_30d > 0 THEN 100 ELSE 0 END) END;

    -- Lifetime total metrics
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_rev, total_ord
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    -- Auxiliary active profiles
    SELECT COUNT(*) INTO active_users_count FROM public.profiles;

    -- Auxiliary low stock count (estoque <= estoque_minimo)
    SELECT COUNT(*) INTO low_stock_count 
    FROM public.produtos 
    WHERE estoque <= COALESCE(estoque_minimo, 5) AND ativo = true AND deleted_at IS NULL;

    -- 4. Revenue & Orders History (Last 30 Days for charts)
    WITH days AS (
        SELECT generate_series(
            date_trunc('day', now()) - interval '29 days',
            date_trunc('day', now()),
            interval '1 day'
        )::date AS day
    )
    SELECT json_agg(h)
    INTO rev_history
    FROM (
        SELECT 
            TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
            TO_CHAR(d.day, 'DD/MM') AS full_date,
            COALESCE(SUM(o.total), 0) AS revenue,
            COUNT(o.id)::int as orders
        FROM days d
        LEFT JOIN public.marketplace_orders o ON date_trunc('day', o.created_at)::date = d.day 
            AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY d.day
        ORDER BY d.day ASC
    ) h;

    -- 5. Top Products (30d)
    SELECT json_agg(p)
    INTO top_prods
    FROM (
        SELECT 
            p.id as id,
            p.nome AS name, -- ALIASED TO 'name' FOR FRONTEND
            SUM(oi.quantity)::int as quantity, -- ALIASED TO 'quantity'
            SUM(oi.quantity * oi.price) as total, -- ALIASED TO 'total'
            COALESCE(p.imagem_url, '') as image -- ALIASED TO 'image'
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.created_at >= now() - interval '30 days'
        AND o.status NOT IN ('cancelled', 'returned')
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
            'revenueTrend', round(month_rev_trend, 1), -- Same as monthly growth
            'ordersTrend', round(month_count_trend, 1),
            'avgTicket', round(avg_ticket_30d, 2),
            'avgTicketTrend', round(avg_ticket_trend, 1),
            'activeCustomers', active_customers_30d,
            'activeCustomersTrend', round(active_customers_trend, 1)
        ),
        'revenueHistory', COALESCE(rev_history, '[]'::json),
        'topProducts', COALESCE(top_prods, '[]'::json),
        'inventoryAlerts', low_stock_count,
        'growth', round(month_rev_trend, 1)
    );

    RETURN result;
END;
$$;

COMMIT;
