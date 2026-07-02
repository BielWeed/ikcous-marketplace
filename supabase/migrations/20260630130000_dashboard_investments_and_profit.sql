-- 20260630130000_dashboard_investments_and_profit.sql
-- Goal: Update get_admin_analytics_v2 to compute inventory cost and value, daily profit and daily COGS.

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

    -- 4. Revenue, Orders, Profit & Cost History (All time)
    WITH days AS (
        SELECT generate_series(
            COALESCE(
                (SELECT MIN(created_at)::date FROM public.marketplace_orders WHERE status NOT IN ('cancelled', 'returned')),
                (now() - interval '29 days')::date
            )::date,
            now()::date,
            interval '1 day'
        )::date AS day
    ),
    daily_orders AS (
        SELECT 
            date_trunc('day', o.created_at)::date AS day,
            COALESCE(SUM(o.total), 0) AS revenue,
            COUNT(o.id)::int as orders
        FROM public.marketplace_orders o
        WHERE o.status NOT IN ('cancelled', 'returned')
        GROUP BY date_trunc('day', o.created_at)::date
    ),
    daily_items AS (
        SELECT 
            date_trunc('day', o.created_at)::date AS day,
            COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0))), 0) AS profit,
            COALESCE(SUM(oi.quantity * COALESCE(p.custo, 0)), 0) AS cost_sold
        FROM public.marketplace_order_items oi
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        LEFT JOIN public.produtos p ON oi.product_id = p.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        GROUP BY date_trunc('day', o.created_at)::date
    )
    SELECT json_agg(h)
    INTO rev_history
    FROM (
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
$$;

COMMIT;
