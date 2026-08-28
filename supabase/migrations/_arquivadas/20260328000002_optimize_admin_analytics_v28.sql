-- v27_analytics_real_growth_and_optimization_v26_fix.sql
-- Goal: Replace placeholders with real calculations and optimize SQL performance using CTEs for single-pass efficiency

BEGIN;

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
    top_products json;
    revenue_history json;
    executive_stats json;
BEGIN
    -- 0. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    -- 1. Metrics Calculation via CTE (Single Pass on marketplace_orders)
    -- 2. Auxiliary Counts
    SELECT COUNT(*) INTO active_users_count FROM public.profiles;
    SELECT COUNT(*) INTO low_stock_count FROM public.produtos WHERE stock <= 5;

    -- 3. Top Products (Otimizado)
    SELECT json_agg(t) INTO top_products
    FROM (
        SELECT 
            p.id,
            p.name,
            COALESCE(p.images->>0, '') as "image",
            COUNT(oi.id) as "quantity",
            SUM(oi.quantity * oi.unit_price) as "total"
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON o.id = oi.order_id
        WHERE o.status IN ('completed', 'paid', 'delivered')
        GROUP BY p.id, p.name, p.images
        ORDER BY "total" DESC
        LIMIT 5
    ) t;

    -- 4. Revenue History (7 dias)
    SELECT json_agg(t) INTO revenue_history
    FROM (
        SELECT 
            TO_CHAR(d.date, 'YYYY-MM-DD') as date,
            TO_CHAR(d.date, 'DD/MM') as "full_date",
            COALESCE(SUM(o.total), 0) as revenue
        FROM (
            SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval)::date as date
        ) d
        LEFT JOIN public.marketplace_orders o ON o.created_at >= d.date 
            AND o.created_at < (d.date + INTERVAL '1 day')
            AND o.status IN ('completed', 'paid', 'delivered')
        GROUP BY d.date
        ORDER BY d.date ASC
    ) t;

    -- 5. Build Final Result
    WITH metrics AS (
        SELECT 
            COALESCE(SUM(CASE WHEN created_at >= (CURRENT_DATE - INTERVAL '24 hours') AND status IN ('completed', 'paid', 'delivered') THEN total ELSE 0 END), 0) as today_rev,
            COUNT(CASE WHEN created_at >= (CURRENT_DATE - INTERVAL '24 hours') AND status IN ('completed', 'paid', 'delivered') THEN 1 END) as today_ord,
            COALESCE(SUM(CASE WHEN created_at >= date_trunc('month', CURRENT_DATE) AND status IN ('completed', 'paid', 'delivered') THEN total ELSE 0 END), 0) as month_rev,
            COUNT(CASE WHEN created_at >= date_trunc('month', CURRENT_DATE) AND status IN ('completed', 'paid', 'delivered') THEN 1 END) as month_ord,
            COALESCE(SUM(CASE WHEN created_at >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') AND created_at < date_trunc('month', CURRENT_DATE) AND status IN ('completed', 'paid', 'delivered') THEN total ELSE 0 END), 0) as prev_month_rev,
            COUNT(CASE WHEN created_at >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') AND created_at < date_trunc('month', CURRENT_DATE) AND status IN ('completed', 'paid', 'delivered') THEN 1 END) as prev_month_ord,
            COALESCE(SUM(CASE WHEN status IN ('completed', 'paid', 'delivered') THEN total ELSE 0 END), 0) as total_rev,
            COUNT(CASE WHEN status IN ('completed', 'paid', 'delivered') THEN 1 END) as total_ord,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_ord
        FROM public.marketplace_orders
    ),
    growth_calcs AS (
        SELECT 
            m.*,
            CASE WHEN m.prev_month_rev > 0 THEN ((m.month_rev - m.prev_month_rev) / m.prev_month_rev) * 100 ELSE 0 END as revenue_growth,
            CASE WHEN m.prev_month_ord > 0 THEN ((m.month_ord::numeric - m.prev_month_ord) / m.prev_month_ord) * 100 ELSE 0 END as order_growth,
            CASE WHEN m.total_ord > 0 THEN m.total_rev / m.total_ord ELSE 0 END as avg_ticket
        FROM metrics m
    )
    SELECT 
        json_build_object(
            'today', json_build_object('revenue', today_rev, 'orders', today_ord),
            'month', json_build_object('revenue', month_rev, 'orders', month_ord, 'revenueTrend', round(revenue_growth, 2), 'orderTrend', round(order_growth, 2)),
            'totalRevenue', total_rev,
            'averageTicket', avg_ticket,
            'pendingOrders', pending_ord,
            'inventoryAlerts', low_stock_count,
            'topProducts', COALESCE(top_products, '[]'::json),
            'revenueHistory', COALESCE(revenue_history, '[]'::json),
            'executive', json_build_object(
                'monthlyGrowth', round(revenue_growth, 2),
                'conversionRate', CASE WHEN active_users_count > 0 THEN round((total_ord::numeric / active_users_count) * 100, 2) ELSE 0 END,
                'activeUsers', active_users_count,
                'lifetimeValue', total_rev,
                'averageTicketTrend', 0,
                'orderGrowth', round(order_growth, 2)
            )
        )
    INTO result
    FROM growth_calcs;

    RETURN result;
END;
$$;

COMMIT;
