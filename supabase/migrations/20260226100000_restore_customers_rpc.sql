-- Migration: restore_customers_rpc
-- Description: Restores the missing get_admin_customers_paged function

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
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;

    -- CTE to gather aggregated stats
    WITH customer_stats AS (
        SELECT 
            p.id,
            u.email, -- Recuperado de auth.users
            p.full_name,
            u.phone, -- Recuperado de auth.users
            p.role,
            p.created_at,
            p.avatar_url,
            COUNT(o.id) as orders_count,
            COALESCE(SUM(o.total::numeric), 0) as total_spent,
            MAX(o.created_at) as last_order_date
        FROM public.profiles p
        LEFT JOIN auth.users u ON u.id = p.id -- Join essencial
        LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
        WHERE (
            p.full_name ILIKE '%' || p_search || '%' OR 
            u.email ILIKE '%' || p_search || '%' OR
            u.phone ILIKE '%' || p_search || '%'
        )
        GROUP BY p.id, u.email, u.phone
    ),
    sorted_data AS (
        SELECT * FROM customer_stats
        ORDER BY 
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE 
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE 
                    WHEN p_sort_field = 'full_name' THEN full_name
                    WHEN p_sort_field = 'email' THEN email
                    WHEN p_sort_field = 'role' THEN role
                    ELSE NULL
                END
            END DESC,
            -- Separate cases for timestamp and numeric to avoid type conflicts in CASE
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
        'total_count', v_total_count
    );
END;
$$;
