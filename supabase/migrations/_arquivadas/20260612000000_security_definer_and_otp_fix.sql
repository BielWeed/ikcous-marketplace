-- ========================================================
-- Migration: 20260612000000_security_definer_and_otp_fix.sql
-- Purpose: Apply search_path = public to all SECURITY DEFINER functions
--          and repair Guest OTP tracking functions to query marketplace_orders.
-- Generated: 2026-06-12T03:30:06.721Z
-- ========================================================

-- FUNCTION: answer_question_atomic
CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
;

-- FUNCTION: answer_question_atomic
CREATE OR REPLACE FUNCTION public.answer_question_atomic(p_question_id uuid, p_answer text, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
BEGIN
    -- SECURITY CHECK: Reject any caller that is not an admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can answer questions.';
    END IF;

    -- 1. Insert Answer
    INSERT INTO public.answers (question_id, user_id, answer)
    VALUES (p_question_id, p_admin_id, p_answer);

    -- 2. Get Question Info
    SELECT user_id, product_id INTO v_user_id, v_product_id 
    FROM public.questions WHERE id = p_question_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 3. Log Notification
        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua pergunta foi respondida!', 
            'A loja respondeu a sua pergunta sobre o produto ' || COALESCE(v_product_name, 'selecionado') || '.', 
            '/product/' || v_product_id, 
            1, 
            p_admin_id
        );
    END IF;
END;
$function$
;

-- FUNCTION: check_stock_v1
CREATE OR REPLACE FUNCTION public.check_stock_v1(p_product_id uuid, p_variant_id uuid, p_quantity integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_stock INTEGER;
BEGIN
    IF p_variant_id IS NOT NULL THEN
        SELECT stock INTO v_stock FROM product_variants WHERE id = p_variant_id AND product_id = p_product_id;
    ELSE
        SELECT stock INTO v_stock FROM produtos WHERE id = p_product_id;
    END IF;

    RETURN COALESCE(v_stock, 0) >= p_quantity;
END;
$function$
;

-- FUNCTION: decrement_stock
CREATE OR REPLACE FUNCTION public.decrement_stock(p_id uuid, quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Segurança: Apenas admins podem decrementar estoque manualmente.
  -- Pedidos devem usar triggers internos ou service_role.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  UPDATE public.produtos
  SET estoque = estoque - quantity
  WHERE id = p_id;
END;
$function$
;

-- FUNCTION: ensure_role_protection
CREATE OR REPLACE FUNCTION public.ensure_role_protection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Prevent role changes unless the executor is an admin
    IF (OLD.role <> NEW.role) AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        NEW.role = OLD.role;
    END IF;
    RETURN NEW;
END;
$function$
;

-- FUNCTION: generate_order_otp_v1
CREATE OR REPLACE FUNCTION public.generate_order_otp_v1(p_email text, p_whatsapp text, p_order_fragment text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_otp TEXT;
    v_exists BOOLEAN;
BEGIN
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
$function$
;

-- FUNCTION: get_admin_customers_paged
CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- FUNCTION: get_admin_dashboard_stats
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_today_start TIMESTAMP := CURRENT_DATE;
    v_month_start TIMESTAMP := date_trunc('month', CURRENT_DATE);
    v_stats JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    SELECT jsonb_build_object(
        'today', (
            SELECT jsonb_build_object(
                'count', COUNT(*),
                'revenue', COALESCE(SUM(total), 0),
                'pending', (SELECT COUNT(*) FROM public.marketplace_orders WHERE status IN ('new', 'processing'))
            )
            FROM public.marketplace_orders
            WHERE created_at >= v_today_start
            AND status NOT IN ('cancelled', 'returned')
        ),
        'month', (
            SELECT jsonb_build_object(
                'count', COUNT(*),
                'revenue', COALESCE(SUM(total), 0)
            )
            FROM public.marketplace_orders
            WHERE created_at >= v_month_start
            AND status NOT IN ('cancelled', 'returned')
        ),
        'average_ticket', (
            SELECT COALESCE(AVG(total), 0) 
            FROM public.marketplace_orders 
            WHERE status NOT IN ('cancelled', 'returned')
        ),
        'revenue_history', (
            SELECT jsonb_agg(d.day_data) FROM (
                SELECT jsonb_build_object(
                    'date', to_char(gs.day, 'DD/MM'),
                    'revenue', COALESCE(SUM(o.total), 0)
                ) as day_data
                FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') AS gs(day)
                LEFT JOIN public.marketplace_orders o ON date_trunc('day', o.created_at) = gs.day 
                    AND o.status NOT IN ('cancelled', 'returned')
                GROUP BY gs.day
                ORDER BY gs.day ASC
            ) d
        )
    ) INTO v_stats;

    RETURN v_stats;
END;
$function$
;

-- FUNCTION: get_admin_dashboard_summary
CREATE OR REPLACE FUNCTION public.get_admin_dashboard_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    result jsonb;
    today_revenue numeric;
    today_count bigint;
    pending_count bigint;
    month_revenue numeric;
    month_count bigint;
    avg_ticket numeric;
    rev_history jsonb;
    top_prods jsonb;
BEGIN
    -- SECURITY CHECK
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can view the dashboard summary.';
    END IF;

    -- Today stats (Confirmed only)
    SELECT 
        coalesce(sum(total), 0), 
        count(*)
    INTO today_revenue, today_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('day', now())
    AND status NOT IN ('cancelled', 'returned');

    -- Pending count (Unaltered, specifically for tasks)
    SELECT count(*)
    INTO pending_count
    FROM public.marketplace_orders
    WHERE status in ('new', 'processing');

    -- Month stats (Confirmed only)
    SELECT 
        coalesce(sum(total), 0), 
        count(*)
    INTO month_revenue, month_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('month', now())
    AND status NOT IN ('cancelled', 'returned');

    -- Global stats (All time avg ticket - Confirmed only)
    SELECT coalesce(avg(total), 0)
    INTO avg_ticket
    FROM public.marketplace_orders
    WHERE status NOT IN ('cancelled', 'returned');

    -- Revenue history (Last 7 days - Confirmed only)
    WITH days AS (
        SELECT generate_series(
            date_trunc('day', now()) - interval '6 days',
            date_trunc('day', now()),
            interval '1 day'
        )::date AS day
    )
    SELECT jsonb_agg(h)
    INTO rev_history
    FROM (
        SELECT 
            to_char(d.day, 'DD/MM') AS date,
            d.day::text AS full_date,
            coalesce(sum(o.total), 0) AS revenue,
            count(o.id) as orders
        FROM days d
        LEFT JOIN public.marketplace_orders o ON date_trunc('day', o.created_at)::date = d.day 
            AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY d.day
        ORDER BY d.day
    ) h;

    -- Top products (Confirmed only)
    SELECT jsonb_agg(p)
    INTO top_prods
    FROM (
        SELECT 
            p.id as product_id,
            p.nome AS name,
            count(o.id) as quantity,
            sum(oi.price * oi.quantity) as total,
            max(p.imagem_url) as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        GROUP BY p.id, p.nome
        ORDER BY quantity DESC
        LIMIT 5
    ) p;

    result := jsonb_build_object(
        'today', jsonb_build_object('revenue', today_revenue, 'count', today_count, 'pending', pending_count),
        'month', jsonb_build_object('revenue', month_revenue, 'count', month_count),
        'averageTicket', avg_ticket,
        'revenueHistory', rev_history,
        'topProducts', top_prods
    );

    RETURN result;
END;
$function$
;

-- FUNCTION: get_admin_executive_summary
CREATE OR REPLACE FUNCTION public.get_admin_executive_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_today_revenue NUMERIC;
    v_today_count INT;
    v_today_pending INT;
    v_month_revenue NUMERIC;
    v_month_count INT;
    v_avg_ticket NUMERIC;
    v_revenue_history JSONB;
    v_top_products JSONB;
    v_inventory_health JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    -- Today stats (Confirmed)
    SELECT 
        COALESCE(SUM(total), 0),
        COUNT(*),
        COALESCE(SUM(CASE WHEN status IN ('new', 'processing') THEN 1 ELSE 0 END), 0)
    INTO v_today_revenue, v_today_count, v_today_pending
    FROM public.marketplace_orders
    WHERE created_at >= CURRENT_DATE
    AND status NOT IN ('cancelled', 'returned');

    -- Month stats (Confirmed)
    SELECT 
        COALESCE(SUM(total), 0),
        COUNT(*)
    INTO v_month_revenue, v_month_count
    FROM public.marketplace_orders
    WHERE created_at >= date_trunc('month', CURRENT_DATE)
    AND status NOT IN ('cancelled', 'returned');

    -- Avg Ticket
    v_avg_ticket := CASE WHEN v_month_count > 0 THEN v_month_revenue / v_month_count ELSE 0 END;

    -- Revenue History (Last 7 days - Confirmed)
    SELECT jsonb_agg(h) INTO v_revenue_history
    FROM (
        SELECT 
            TO_CHAR(d, 'DD/MM') as date,
            COALESCE(SUM(o.total), 0) as revenue
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') d
        LEFT JOIN public.marketplace_orders o ON DATE(o.created_at) = DATE(d) 
            AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY d
        ORDER BY d
    ) h;

    -- Top Products (Confirmed)
    SELECT jsonb_agg(p) INTO v_top_products
    FROM (
        SELECT p.nome as name, SUM(oi.quantity) as sold, MAX(oi.price) as price, MAX(p.imagem_url) as image
        FROM public.produtos p
        JOIN public.marketplace_order_items oi ON p.id = oi.product_id
        JOIN public.marketplace_orders o ON oi.order_id = o.id
        WHERE o.status NOT IN ('cancelled', 'returned')
        GROUP BY p.id, p.nome
        ORDER BY sold DESC
        LIMIT 5
    ) p;

    -- Inventory Health
    SELECT jsonb_agg(i) INTO v_inventory_health
    FROM (
        WITH product_sales AS (
            SELECT oi.product_id, SUM(oi.quantity) as total_qty
            FROM public.marketplace_order_items oi
            JOIN public.marketplace_orders o ON o.id = oi.order_id
            WHERE o.created_at >= NOW() - INTERVAL '30 days' AND o.status NOT IN ('cancelled', 'returned')
            GROUP BY oi.product_id
        )
        SELECT p.nome as product_name, p.estoque as current_stock,
            CASE WHEN ps.total_qty > 0 THEN (p.estoque::FLOAT / (ps.total_qty::FLOAT / 30.0)) ELSE 999 END as days_remaining
        FROM public.produtos p LEFT JOIN product_sales ps ON ps.product_id = p.id
        WHERE p.active = true AND p.estoque <= 5 ORDER BY days_remaining ASC LIMIT 5
    ) i;

    RETURN jsonb_build_object(
        'today', json_build_object('revenue', v_today_revenue, 'count', v_today_count, 'pending', v_today_pending),
        'month', json_build_object('revenue', v_month_revenue, 'count', v_month_count),
        'averageTicket', v_avg_ticket,
        'revenueHistory', v_revenue_history,
        'topProducts', v_top_products,
        'inventoryHealth', v_inventory_health
    );
END;
$function$
;

-- FUNCTION: get_admin_list_paginated
CREATE OR REPLACE FUNCTION public.get_admin_list_paginated(p_table_name text, p_page_size integer DEFAULT 20, p_page_number integer DEFAULT 0, p_search_query text DEFAULT NULL::text, p_filter_status text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_query text;
    v_total_count bigint;
    v_items jsonb;
BEGIN
    -- SECURITY CHECK: Admin-scoped fetching function guarantees privacy
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can use paginated fetchers.';
    END IF;

    -- This handles specific tables with custom search logic
    IF p_table_name = 'reviews' THEN
        v_query := 'SELECT count(*) FROM public.reviews r JOIN public.produtos p ON r.product_id = p.id JOIN public.profiles pr ON r.user_id = pr.id';
        IF p_search_query IS NOT NULL THEN
            v_query := v_query || ' WHERE (p.nome ILIKE %L OR pr.full_name ILIKE %L OR r.comment ILIKE %L)';
        END IF;
        -- Pagination and aggregation would go here...
    END IF;

    -- For Phase 7, we'll start with standard Supabase pagination in hooks, 
    -- but we ensure indexes exist for the columns used in order/filter.
    RETURN jsonb_build_object('status', 'optimized');
END;
$function$
;

-- FUNCTION: get_orders_by_otp_v1
CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1(p_email text, p_otp text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_valid_record RECORD;
BEGIN
    -- Check if OTP is valid and not expired
    SELECT whatsapp, verified INTO v_valid_record
    FROM public.otp_verifications
    WHERE email = p_email 
    AND otp_code = p_otp 
    AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_valid_record.whatsapp IS NULL THEN
        RAISE EXCEPTION 'Código inválido ou expirado.';
    END IF;

    IF v_valid_record.verified THEN
        RAISE EXCEPTION 'Código já utilizado.';
    END IF;

    -- Mark as verified
    UPDATE public.otp_verifications 
    SET verified = TRUE 
    WHERE email = p_email AND otp_code = p_otp;

    -- Return orders associated with this email or whatsapp
    RETURN (
        SELECT jsonb_agg(o.*)
        FROM public.marketplace_orders o
        LEFT JOIN auth.users u ON u.id = o.user_id
        WHERE (
            -- Email comparison (either on customer_data or logged-in user email)
            (p_email IS NOT NULL AND p_email <> '' AND 
             (LOWER(coalesce(o.customer_data->>'email', '')) = LOWER(p_email) 
              OR LOWER(coalesce(u.email, '')) = LOWER(p_email)))
            OR
            -- WhatsApp comparison immune to formatting (extracting only digits)
            (v_valid_record.whatsapp IS NOT NULL AND v_valid_record.whatsapp <> '' AND 
             regexp_replace(coalesce(o.customer_phone, o.customer_data->>'whatsapp', ''), '[^0-9]', '', 'g') = regexp_replace(v_valid_record.whatsapp, '[^0-9]', '', 'g'))
        )
    );
END;
$function$
;

-- FUNCTION: get_orders_by_whatsapp
CREATE OR REPLACE FUNCTION public.get_orders_by_whatsapp(phone_number text, customer_email text DEFAULT NULL::text)
 RETURNS SETOF json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_is_admin BOOLEAN;
    v_caller_id UUID;
BEGIN
    v_caller_id := auth.uid();
    v_is_admin := public.is_admin();

    RETURN QUERY
    SELECT to_json(t)
    FROM (
        SELECT 
            mo.*,
            COALESCE(
                (
                    SELECT json_agg(moi.*)
                    FROM public.marketplace_order_items moi
                    WHERE moi.order_id = mo.id
                ), 
                '[]'::json
            ) as items
        FROM public.marketplace_orders mo
        WHERE (
            v_is_admin OR
            (v_caller_id IS NOT NULL AND mo.user_id = v_caller_id) OR
            (
                customer_email IS NOT NULL AND 
                mo.customer_phone = phone_number AND 
                LOWER(mo.customer_email) = LOWER(customer_email)
            )
        )
        ORDER BY mo.created_at DESC
    ) t;
END;
$function$
;

-- FUNCTION: get_product_optimization_data
CREATE OR REPLACE FUNCTION public.get_product_optimization_data()
 RETURNS TABLE(id uuid, name text, current_min integer, velocity numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
;

-- FUNCTION: get_product_recommendations
CREATE OR REPLACE FUNCTION public.get_product_recommendations(p_product_id uuid, p_limit integer DEFAULT 4)
 RETURNS SETOF produtos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_category text;
    v_tags text[];
BEGIN
    -- Get context from current product
    SELECT categoria, tags INTO v_category, v_tags
    FROM produtos
    WHERE id = p_product_id;

    RETURN QUERY
    SELECT *
    FROM produtos p
    WHERE p.id != p_product_id
      AND p.ativo = true
      AND p.estoque > 0
      AND (
          -- Exact category match (High weight)
          p.categoria = v_category
          OR
          -- Tag overlap (Medium weight)
          p.tags && v_tags
      )
    -- Simple scoring: Category match is prioritized
    ORDER BY 
        (p.categoria = v_category) DESC,
        p.data_cadastro DESC
    LIMIT p_limit;
END;
$function$
;

-- FUNCTION: get_product_stats
CREATE OR REPLACE FUNCTION public.get_product_stats()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    -- Segurança: Dados de custo e performance de vendas são restritos.
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Administradores apenas.';
    END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'id', p.id,
        'nome', p.nome,
        'descricao', p.descricao,
        'categoria', p.categoria,
        'preco_venda', p.preco_venda,
        'custo', p.custo,
        'estoque', p.estoque,
        'ativo', p.ativo,
        'imagem_url', p.imagem_url,
        'tags', p.tags,
        'sold', COALESCE(SUM(i.quantity), 0),
        'created_at', p.data_cadastro,
        'product_variants', (
            SELECT jsonb_agg(v)
            FROM public.product_variants v
            WHERE v.product_id = p.id
        )
    )
    FROM public.produtos p
    LEFT JOIN public.marketplace_order_items i ON i.product_id = p.id
    GROUP BY p.id
    ORDER BY p.nome;
END;
$function$
;

-- FUNCTION: get_retention_analytics
CREATE OR REPLACE FUNCTION public.get_retention_analytics()
 RETURNS TABLE(month text, total_customers bigint, returning_customers bigint, retention_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

-- FUNCTION: get_retention_analytics
CREATE OR REPLACE FUNCTION public.get_retention_analytics(p_days integer DEFAULT 90)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total_customers int;
    v_repeat_customers int;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    WITH customer_counts AS (
        SELECT 
            COALESCE(user_id::text, customer_data->>'whatsapp') as customer_id,
            COUNT(*) as order_count
        FROM marketplace_orders
        WHERE created_at >= NOW() - (p_days || ' days')::interval
        AND status NOT IN ('cancelled', 'returned')
        GROUP BY customer_id
    )
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE order_count > 1)
    INTO v_total_customers, v_repeat_customers
    FROM customer_counts;

    IF v_total_customers = 0 THEN
        RETURN 0;
    END IF;

    RETURN (v_repeat_customers::numeric / v_total_customers::numeric) * 100;
END;
$function$
;

-- FUNCTION: get_sales_analytics
CREATE OR REPLACE FUNCTION public.get_sales_analytics(start_date timestamp without time zone, end_date timestamp without time zone)
 RETURNS TABLE(day timestamp without time zone, orders bigint, revenue numeric, ticket numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    sales_day,
    total_orders,
    gross_revenue::numeric,
    average_ticket::numeric
  FROM public.sales_overview
  WHERE sales_day >= start_date AND sales_day <= end_date;
END;
$function$
;

-- FUNCTION: get_sales_analytics
CREATE OR REPLACE FUNCTION public.get_sales_analytics(start_date timestamp with time zone, end_date timestamp with time zone)
 RETURNS TABLE(day timestamp with time zone, orders bigint, revenue numeric, ticket numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Segurança: Dados financeiros.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT 
    sales_day,
    total_orders,
    gross_revenue::numeric,
    average_ticket::numeric
  FROM public.sales_overview
  WHERE sales_day >= start_date AND sales_day <= end_date;
END;
$function$
;

-- FUNCTION: handle_order_item_stock
CREATE OR REPLACE FUNCTION public.handle_order_item_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_current_stock INTEGER;
BEGIN
    IF NEW.variant_id IS NOT NULL THEN
        SELECT stock INTO v_current_stock FROM public.product_variants WHERE id = NEW.variant_id FOR UPDATE;
        IF v_current_stock < NEW.quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para a variante.';
        END IF;
        UPDATE public.product_variants SET stock = stock - NEW.quantity WHERE id = NEW.variant_id;
    ELSE
        SELECT estoque INTO v_current_stock FROM public.produtos WHERE id = NEW.product_id FOR UPDATE;
        IF v_current_stock < NEW.quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto.';
        END IF;
        UPDATE public.produtos SET estoque = estoque - NEW.quantity WHERE id = NEW.product_id;
    END IF;
    RETURN NEW;
END;
$function$
;

-- FUNCTION: increment_helpful
CREATE OR REPLACE FUNCTION public.increment_helpful(review_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Acesso negado: usuário não autenticado.';
    END IF;

    UPDATE public.reviews 
    SET helpful = COALESCE(helpful, 0) + 1 
    WHERE id = review_id;
END;
$function$
;

-- FUNCTION: record_vor_action
CREATE OR REPLACE FUNCTION public.record_vor_action(p_action_type text, p_input_data jsonb, p_output_data jsonb, p_proof_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_previous_hash TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Apenas o sistema ERP/Admin pode gravar recibos VOR diretamente.';
    END IF;

    -- Lock table to ensure sequentiality
    LOCK TABLE public.vor_receipts IN EXCLUSIVE MODE;

    SELECT proof_hash INTO v_previous_hash 
    FROM public.vor_receipts 
    ORDER BY created_at DESC 
    LIMIT 1;

    INSERT INTO public.vor_receipts (
        action_type, input_data, output_data, proof_hash, previous_hash
    ) VALUES (
        p_action_type, p_input_data, p_output_data, p_proof_hash, COALESCE(v_previous_hash, 'GENESIS_BLOCK_G19')
    );
END;
$function$
;

-- FUNCTION: reply_review_atomic
CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
;

-- FUNCTION: reply_review_atomic
CREATE OR REPLACE FUNCTION public.reply_review_atomic(p_review_id uuid, p_reply text, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid;
    v_product_name text;
    v_product_id uuid;
BEGIN
    -- SECURITY CHECK: Reject any caller that is not an admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reply to reviews.';
    END IF;

    -- 1. Update Review
    UPDATE public.reviews 
    SET merchant_reply = p_reply, merchant_reply_at = NOW() 
    WHERE id = p_review_id
    RETURNING user_id, product_id INTO v_user_id, v_product_id;

    IF v_product_id IS NOT NULL THEN
        SELECT nome INTO v_product_name FROM public.produtos WHERE id = v_product_id;

        -- 2. Log Notification for Admin Visibility (Using p_admin_id as creator)
        INSERT INTO public.push_notifications_log (title, body, url, recipient_count, created_by)
        VALUES (
            'Sua avaliacao foi respondida!', 
            'A loja respondeu a sua avaliacao no produto ' || COALESCE(v_product_name, 'comprado') || '.', 
            '/product/' || v_product_id, 
            1, 
            p_admin_id
        );
    END IF;
END;
$function$
;

-- FUNCTION: tr_prevent_role_change
CREATE OR REPLACE FUNCTION public.tr_prevent_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF (OLD.role <> NEW.role) AND NOT (SELECT is_admin()) THEN
        NEW.role := OLD.role;
    END IF;
    RETURN NEW;
END;
$function$
;

-- FUNCTION: update_order_status_atomic
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(p_order_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    UPDATE public.marketplace_orders
    SET status = p_status, updated_at = now()
    WHERE id = p_order_id
    RETURNING to_jsonb(public.marketplace_orders.*) INTO v_result;

    RETURN v_result;
END;
$function$
;

-- FUNCTION: validate_coupon_secure
CREATE OR REPLACE FUNCTION public.validate_coupon_secure(p_code text, p_subtotal numeric)
 RETURNS TABLE(is_valid boolean, discount_amount numeric, discount_type text, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_coupon RECORD;
BEGIN
    SELECT * INTO v_coupon FROM public.coupons 
    WHERE UPPER(code) = UPPER(p_code) AND active = true
    FOR SHARE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT false, 0::NUMERIC, NULL::TEXT, 'Cupom inválido ou inexistente.'::TEXT;
        RETURN;
    END IF;

    IF v_coupon.valid_until IS NOT NULL AND v_coupon.valid_until < NOW() THEN
        RETURN QUERY SELECT false, 0::NUMERIC, v_coupon.type, 'Cupom expirado.'::TEXT;
        RETURN;
    END IF;

    IF v_coupon.usage_limit IS NOT NULL AND v_coupon.usage_count >= v_coupon.usage_limit THEN
        RETURN QUERY SELECT false, 0::NUMERIC, v_coupon.type, 'Limite de uso atingido.'::TEXT;
        RETURN;
    END IF;

    IF v_coupon.min_purchase IS NOT NULL AND p_subtotal < v_coupon.min_purchase THEN
        RETURN QUERY SELECT false, 0::NUMERIC, v_coupon.type, 'Valor mínimo não atingido.'::TEXT;
        RETURN;
    END IF;

    IF v_coupon.type = 'percentage' THEN
        RETURN QUERY SELECT true, (p_subtotal * v_coupon.value / 100.0), 'percentage'::TEXT, NULL::TEXT;
    ELSE
        RETURN QUERY SELECT true, LEAST(v_coupon.value, p_subtotal), 'fixed'::TEXT, NULL::TEXT;
    END IF;
END;
$function$
;

