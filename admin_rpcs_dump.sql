
--- RPC: get_segmented_push_targets ---
CREATE OR REPLACE FUNCTION public.get_segmented_push_targets(p_segment text DEFAULT 'all'::text, p_min_ltv numeric DEFAULT 0, p_days_inactive integer DEFAULT 0)
 RETURNS TABLE(endpoint text, p256dh text, auth text, user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    RETURN QUERY
    SELECT 
        ps.endpoint,
        ps.p256dh,
        ps.auth,
        ps.user_id
    FROM public.push_subscriptions ps
    LEFT JOIN public.profiles p ON p.id = ps.user_id
    LEFT JOIN (
        SELECT 
            user_id, 
            SUM(total) as ltv, 
            MAX(created_at) as last_order
        FROM public.marketplace_orders
        WHERE status NOT IN ('cancelled', 'returned')
        GROUP BY user_id
    ) stats ON stats.user_id = ps.user_id
    WHERE 
        CASE 
            WHEN p_segment = 'vip' THEN COALESCE(stats.ltv, 0) >= 500 -- Example threshold
            WHEN p_segment = 'inactive' THEN COALESCE(stats.last_order, '1970-01-01'::timestamp) < (NOW() - INTERVAL '30 days')
            WHEN p_segment = 'new' THEN p.created_at > (NOW() - INTERVAL '7 days')
            ELSE TRUE
        END
        AND (p_min_ltv = 0 OR COALESCE(stats.ltv, 0) >= p_min_ltv)
        AND (p_days_inactive = 0 OR COALESCE(stats.last_order, '1970-01-01'::timestamp) < (NOW() - p_days_inactive * INTERVAL '1 day'));
END;
$function$

----------------------

--- RPC: get_admin_customers_paged ---
CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
$function$

----------------------

--- RPC: upsert_store_config ---
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
BEGIN
  INSERT INTO public.store_config (
    id,
    free_shipping_min,
    shipping_fee,
    whatsapp_number,
    share_text,
    business_hours,
    enable_reviews,
    enable_coupons,
    primary_color,
    theme_mode,
    logo_url,
    real_time_sales_alerts,
    push_marketing_enabled,
    min_app_version
  )
  VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 100),
    COALESCE((config_json->>'shipping_fee')::numeric, 15),
    COALESCE(config_json->>'whatsapp_number', '5534999999999'),
    COALESCE(config_json->>'share_text', 'Confira os produtos da Ikous!'),
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
$function$

----------------------

--- RPC: reply_review_atomic ---
CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
    v_admin_id uuid;
BEGIN
    -- SECURITY CHECK: Ensure the caller is an admin
    v_admin_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    -- 1. Update Review
    UPDATE reviews 
    SET merchant_reply = p_reply, merchant_reply_at = NOW() 
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;

        -- 2. Log Notification for Admin Visibility
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliação foi respondida!', 
            'A loja respondeu à sua avaliação no produto ' || COALESCE(v_product_name, 'comprado') || '.', 
            '/product/' || v_product_id, 
            1, 
            v_admin_id
        );
    END IF;
END;
$function$

----------------------

--- RPC: answer_question_atomic ---
CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
    v_admin_id uuid;
BEGIN
    -- SECURITY CHECK: Ensure the caller is an admin
    v_admin_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_admin_id AND role = 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    -- 1. Insert Answer
    INSERT INTO answers (question_id, user_id, answer)
    VALUES (p_question_id, v_admin_id, p_answer);

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id 
    FROM questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM produtos WHERE id = v_product_id;

        -- 3. Log Notification
        INSERT INTO push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua pergunta foi respondida!', 
            'A loja respondeu à sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.', 
            '/product/' || v_product_id, 
            1, 
            v_admin_id
        );
    END IF;
END;
$function$

----------------------

--- RPC: update_order_status_atomic ---
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
BEGIN
    -- Get current status and user
    SELECT status, user_id INTO v_old_status, v_user_id FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;

    -- Update Order
    UPDATE public.marketplace_orders 
    SET status = p_new_status, updated_at = NOW() 
    WHERE id = p_order_id;

    -- Log History (Assuming table exists from previous step)
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, auth.uid());
END;
$function$

----------------------

--- RPC: get_product_optimization_data ---
CREATE OR REPLACE FUNCTION public.get_product_optimization_data()
 RETURNS TABLE(id uuid, name text, current_min integer, velocity numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    RETURN QUERY
    WITH sales_90d AS (
        SELECT 
            oi.product_id,
            SUM(oi.quantity)::numeric / 90.0 as daily_velocity
        FROM marketplace_order_items oi
        JOIN marketplace_orders o ON oi.order_id = o.id
        WHERE o.created_at >= NOW() - INTERVAL '90 days'
        AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY oi.product_id
    )
    SELECT 
        p.id,
        p.nome as name,
        COALESCE(p.estoque_minimo, 0) as current_min,
        COALESCE(s.daily_velocity, 0)::numeric as velocity
    FROM produtos p
    LEFT JOIN sales_90d s ON p.id = s.product_id
    WHERE COALESCE(s.daily_velocity, 0) > 0 OR p.estoque < COALESCE(p.estoque_minimo, 0);
END;
$function$

----------------------

--- RPC: get_coupon_stats ---
CREATE OR REPLACE FUNCTION public.get_coupon_stats()
 RETURNS TABLE(total_coupons bigint, active_coupons bigint, total_uses bigint, avg_discount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        COUNT(*) FILTER (WHERE active = true)::BIGINT,
        SUM(usage_count)::BIGINT,
        AVG(value)::NUMERIC
    FROM public.coupons;
END;
$function$

----------------------

--- RPC: swap_banner_order ---
CREATE OR REPLACE FUNCTION public.swap_banner_order(banner_id_1 uuid, banner_id_2 uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    order_1 INTEGER;
    order_2 INTEGER;
BEGIN
    SELECT "order" INTO order_1 FROM public.banners WHERE id = banner_id_1;
    SELECT "order" INTO order_2 FROM public.banners WHERE id = banner_id_2;

    UPDATE public.banners SET "order" = order_2 WHERE id = banner_id_1;
    UPDATE public.banners SET "order" = order_1 WHERE id = banner_id_2;
END;
$function$

----------------------

--- RPC: get_inventory_health ---
CREATE OR REPLACE FUNCTION public.get_inventory_health()
 RETURNS TABLE(product_id uuid, product_name text, current_stock integer, sales_last_30d bigint, days_remaining numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
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
        COALESCE(ps.total_qty, 0) as sales_last_30d,
        CASE WHEN ps.total_qty IS NULL OR ps.total_qty = 0 THEN 999 ELSE (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) END as days_remaining
    FROM public.produtos p
    LEFT JOIN product_sales ps ON ps.product_id = p.id
    WHERE p.estoque < 20 OR (ps.total_qty > 0 AND (p.estoque::NUMERIC / (ps.total_qty::NUMERIC / 30.0)) < 7)
    ORDER BY days_remaining ASC;
END;
$function$

----------------------

--- RPC: get_category_analytics ---
CREATE OR REPLACE FUNCTION public.get_category_analytics(p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS TABLE(name text, value numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    RETURN QUERY
    SELECT 
        COALESCE(p.categoria, 'Geral') as name,
        SUM(oi.price * oi.quantity)::numeric as value
    FROM marketplace_order_items oi
    JOIN produtos p ON oi.product_id = p.id
    JOIN marketplace_orders o ON oi.order_id = o.id
    WHERE o.created_at >= p_start_date AND o.created_at <= p_end_date
    AND o.status NOT IN ('cancelled', 'returned')
    GROUP BY COALESCE(p.categoria, 'Geral')
    ORDER BY value DESC;
END;
$function$

----------------------

--- RPC: get_customer_intelligence ---
CREATE OR REPLACE FUNCTION public.get_customer_intelligence()
 RETURNS TABLE(customer_id uuid, customer_name text, total_spent numeric, order_count bigint, last_order_at timestamp with time zone, ltv_score numeric, is_push_subscribed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        p.id as customer_id,
        p.full_name as customer_name,
        COALESCE(SUM(o.total), 0) as total_spent,
        COUNT(o.id) as order_count,
        MAX(o.created_at) as last_order_at,
        (COALESCE(SUM(o.total), 0) * 0.7 + COUNT(o.id) * 0.3) as ltv_score,
        EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = p.id) as is_push_subscribed
    FROM public.profiles p
    LEFT JOIN public.marketplace_orders o ON o.user_id = p.id AND o.status NOT IN ('cancelled', 'returned')
    GROUP BY p.id, p.full_name
    ORDER BY ltv_score DESC
    LIMIT 20;
END;
$function$

----------------------

--- RPC: get_retention_analytics ---
CREATE OR REPLACE FUNCTION public.get_retention_analytics()
 RETURNS TABLE(month text, total_customers bigint, returning_customers bigint, retention_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
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
            COUNT(DISTINCT curr.user_id) as total_users,
            COUNT(DISTINCT prev.user_id) as returning_users
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
$function$

----------------------

--- RPC: get_retention_rate ---
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
$function$

----------------------
