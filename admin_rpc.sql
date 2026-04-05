CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_today_start TIMESTAMP := CURRENT_DATE::TIMESTAMP;
    v_month_start TIMESTAMP := DATE_TRUNC('month', CURRENT_DATE);
    v_month_prev_start TIMESTAMP := v_month_start - INTERVAL '1 month';
    v_month_prev_end TIMESTAMP := v_month_start - INTERVAL '1 second';
    
    v_curr_month_rev NUMERIC;
    v_prev_month_rev NUMERIC;
    v_rev_trend NUMERIC;
    
    v_curr_month_orders BIGINT;
    v_prev_month_orders BIGINT;
    v_orders_trend NUMERIC;

    v_inventory_alerts BIGINT;
    v_result JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Requer privilégios de administrador.';
    END IF;

    -- Revenue and count for current month
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_curr_month_rev, v_curr_month_orders
    FROM public.marketplace_orders
    WHERE created_at >= v_month_start AND status NOT IN ('cancelled', 'returned');

    -- Revenue and count for previous month
    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_prev_month_rev, v_prev_month_orders
    FROM public.marketplace_orders
    WHERE created_at >= v_month_prev_start AND created_at <= v_month_prev_end 
    AND status NOT IN ('cancelled', 'returned');

    -- Calculate Trends
    v_rev_trend := CASE WHEN v_prev_month_rev > 0 THEN ((v_curr_month_rev - v_prev_month_rev) / v_prev_month_rev) * 100 ELSE 0 END;
    v_orders_trend := CASE WHEN v_prev_month_orders > 0 THEN ((v_curr_month_orders::NUMERIC - v_prev_month_orders) / v_prev_month_orders) * 100 ELSE 0 END;

    -- Inventory Alerts (Items below minimum stock)
    SELECT COUNT(*) INTO v_inventory_alerts
    FROM public.produtos
    WHERE estoque <= COALESCE(estoque_minimo, 0) AND estoque_minimo > 0;

    WITH stats_today AS (
        SELECT 
            COALESCE(SUM(total), 0) as revenue,
            COUNT(*) as count,
            COUNT(*) FILTER (WHERE status = 'new') as pending
        FROM public.marketplace_orders
        WHERE created_at >= v_today_start AND status NOT IN ('cancelled', 'returned')
    ),
    revenue_history AS (
        SELECT 
            TO_CHAR(day, 'DD/MM') as date,
            TO_CHAR(day, 'YYYY-MM-DD') as full_date,
            COALESCE(SUM(o.total), 0) as revenue,
            COUNT(o.id) as orders
        FROM GENERATE_SERIES(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') day
        LEFT JOIN public.marketplace_orders o ON DATE_TRUNC('day', o.created_at) = day AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY 1, 2 ORDER BY 2
    ),
    top_products AS (
        SELECT 
            oi.product_id as id,
            p.nome as name,
            SUM(oi.quantity) as quantity,
            SUM(oi.price * oi.quantity) as total,
            p.imagem_url as image
        FROM public.marketplace_order_items oi
        JOIN public.produtos p ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON o.id = oi.order_id
        WHERE o.status NOT IN ('cancelled', 'returned')
        GROUP BY 1, 2, 5
        ORDER BY 3 DESC LIMIT 5
    )
    SELECT jsonb_build_object(
        'today', (SELECT jsonb_build_object('revenue', revenue, 'count', count, 'pending', pending) FROM stats_today),
        'month', jsonb_build_object('revenue', v_curr_month_rev, 'count', v_curr_month_orders),
        'revenueTrend', ROUND(v_rev_trend, 1),
        'ordersTrend', ROUND(v_orders_trend, 1),
        'inventoryAlerts', v_inventory_alerts,
        'averageTicket', CASE WHEN v_curr_month_orders > 0 THEN ROUND(v_curr_month_rev / v_curr_month_orders, 2) ELSE 0 END,
        'revenueHistory', (SELECT jsonb_agg(row_to_json(rh)) FROM revenue_history rh),
        'topProducts', (SELECT jsonb_agg(row_to_json(tp)) FROM top_products tp),
        'executive', jsonb_build_object(
            'monthlyGrowth', ROUND(v_rev_trend, 1),
            'conversionRate', 2.4, -- Placeholder for now, requires session tracking
            'retentionRate', (SELECT public.get_retention_rate())
        )
    ) INTO v_result;

    RETURN v_result;
END;
$function$
