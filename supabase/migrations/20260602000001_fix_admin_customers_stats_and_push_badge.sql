-- Migration: fix_admin_customers_stats_and_push_badge
-- Description: Updates get_admin_customers_paged to return global statistics, map is_push_subscribed from push_subscriptions, and prioritize profile whatsapp with auth user phone fallback.

DROP FUNCTION IF EXISTS public.get_admin_customers_paged(TEXT, TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(
    p_search TEXT DEFAULT '',
    p_sort_field TEXT DEFAULT 'created_at',
    p_sort_direction TEXT DEFAULT 'desc',
    p_page INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    
    -- Global stats variables
    v_global_total_customers BIGINT;
    v_global_new_customers_30d BIGINT;
    v_global_ltv NUMERIC;
    v_global_orders BIGINT;
    v_stats JSONB;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;

    -- Calculate global stats (not filtered by search for global dashboard consistency)
    SELECT COUNT(id) INTO v_global_total_customers 
    FROM public.profiles;

    SELECT COUNT(id) INTO v_global_new_customers_30d 
    FROM public.profiles 
    WHERE created_at >= NOW() - INTERVAL '30 days';

    SELECT COUNT(id) INTO v_global_orders 
    FROM public.marketplace_orders 
    WHERE status NOT IN ('cancelled', 'returned');

    SELECT COALESCE(SUM(total::numeric), 0) INTO v_global_ltv 
    FROM public.marketplace_orders 
    WHERE status NOT IN ('cancelled', 'returned');

    v_stats := JSONB_BUILD_OBJECT(
        'total_customers', v_global_total_customers,
        'new_customers_30d', v_global_new_customers_30d,
        'global_ltv', v_global_ltv,
        'global_orders', v_global_orders
    );

    -- CTE to gather aggregated stats per customer
    WITH customer_stats AS (
        SELECT 
            p.id,
            u.email, 
            p.full_name,
            COALESCE(p.whatsapp, u.phone) as phone, 
            p.role,
            p.created_at,
            p.avatar_url,
            addr.city,
            addr.state,
            EXISTS (
                SELECT 1 
                FROM public.push_subscriptions 
                WHERE user_id = p.id
            ) as is_push_subscribed,
            COUNT(o.id) as orders_count,
            COALESCE(SUM(o.total::numeric), 0) as total_spent,
            MAX(o.created_at) as last_order_date
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id
        LEFT JOIN public.user_addresses addr ON addr.user_id = p.id AND addr.is_default = true
        LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
        WHERE (
            p.full_name ILIKE '%' || p_search || '%' OR 
            u.email ILIKE '%' || p_search || '%' OR
            u.phone ILIKE '%' || p_search || '%' OR
            p.whatsapp ILIKE '%' || p_search || '%' OR
            addr.city ILIKE '%' || p_search || '%' OR
            addr.state ILIKE '%' || p_search || '%'
        )
        GROUP BY p.id, u.email, u.phone, p.whatsapp, addr.city, addr.state
    ),
    sorted_data AS (
        SELECT * FROM customer_stats
        ORDER BY 
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE 
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE 
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    WHEN p_sort_field = 'city' THEN city
                    ELSE NULL
                END
            END DESC,
            CASE WHEN p_sort_direction = 'asc' AND p_sort_field = 'created_at' THEN created_at END ASC,
            CASE WHEN p_sort_direction = 'desc' AND p_sort_field = 'created_at' THEN created_at END DESC,
            CASE WHEN p_sort_direction = 'asc' AND p_sort_field = 'last_order_date' THEN last_order_date END ASC,
            CASE WHEN p_sort_direction = 'desc' AND p_sort_field = 'last_order_date' THEN last_order_date END DESC,
            CASE WHEN p_sort_direction = 'asc' AND p_sort_field = 'orders_count' THEN orders_count END ASC,
            CASE WHEN p_sort_direction = 'desc' AND p_sort_field = 'orders_count' THEN orders_count END DESC,
            CASE WHEN p_sort_direction = 'asc' AND p_sort_field = 'total_spent' THEN total_spent END ASC,
            CASE WHEN p_sort_direction = 'desc' AND p_sort_field = 'total_spent' THEN total_spent END DESC
        LIMIT p_page_size
        OFFSET v_offset
    )
    SELECT 
        (SELECT COUNT(*) FROM customer_stats),
        COALESCE(JSONB_AGG(d), '[]'::JSONB)
    INTO v_total_count, v_data
    FROM sorted_data d;

    RETURN JSONB_BUILD_OBJECT(
        'data', v_data,
        'total_count', v_total_count,
        'stats', v_stats
    );
END;
$$;
