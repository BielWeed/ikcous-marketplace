-- Migration: Final Database Security Hardening and Performance Tuning
-- Date: 2026-07-08
-- Version: 20260708160000

BEGIN;

-- ============================================================================
-- 1. MOVE UNACCENT EXTENSION TO DESIGNATED SCHEMA (Resolves extension_in_public)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION unaccent SET SCHEMA extensions;


-- ============================================================================
-- 2. RECREATE SEARCH FUNCTIONS WITH UPDATED search_path (SET search_path = public, extensions)
-- ============================================================================

-- Function: get_admin_orders_paged
CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(
    p_search TEXT DEFAULT ''::TEXT,
    p_status TEXT DEFAULT 'all'::TEXT,
    p_start_date TEXT DEFAULT ''::TEXT,
    p_end_date TEXT DEFAULT ''::TEXT,
    p_page INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Compute total count with filters (before pagination)
    SELECT COUNT(o.id) INTO v_total_count
    FROM public.marketplace_orders o
    WHERE (p_status = 'all' OR o.status = p_status)
      AND (p_start_date = '' OR o.created_at >= p_start_date::TIMESTAMPTZ)
      AND (p_end_date = '' OR o.created_at <= p_end_date::TIMESTAMPTZ)
      AND (
        v_clean_search = '' OR (
          unaccent(o.customer_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          o.id::TEXT ILIKE '%' || v_clean_search || '%' OR
          o.customer_phone ILIKE '%' || v_clean_search || '%' OR
          unaccent(o.coupon_code) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(o.tracking_code) ILIKE unaccent('%' || v_clean_search || '%') OR
          EXISTS (
              SELECT 1 FROM public.marketplace_order_items oi
              WHERE oi.order_id = o.id 
                AND unaccent(oi.product_name) ILIKE unaccent('%' || v_clean_search || '%')
          )
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            o.*,
            (
                SELECT COALESCE(
                    jsonb_agg(
                        jsonb_build_object(
                            'id', oi.id,
                            'order_id', oi.order_id,
                            'product_id', oi.product_id,
                            'variant_id', oi.variant_id,
                            'quantity', oi.quantity,
                            'price', oi.price,
                            'product_name', oi.product_name,
                            'image_url', oi.image_url,
                            'product', (
                                SELECT jsonb_build_object(
                                    'imagem_url', p.imagem_url, 
                                    'imagem_urls', p.imagem_urls
                                )
                                FROM public.produtos p
                                WHERE p.id = oi.product_id
                            )
                        )
                    ),
                    '[]'::JSONB
                )
                FROM public.marketplace_order_items oi
                WHERE oi.order_id = o.id
            ) AS items,
            (
                SELECT to_jsonb(addr.*)
                FROM public.user_addresses addr
                WHERE addr.id = o.address_id
            ) AS address
        FROM public.marketplace_orders o
        WHERE (p_status = 'all' OR o.status = p_status)
          AND (p_start_date = '' OR o.created_at >= p_start_date::TIMESTAMPTZ)
          AND (p_end_date = '' OR o.created_at <= p_end_date::TIMESTAMPTZ)
          AND (
            v_clean_search = '' OR (
              unaccent(o.customer_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              o.id::TEXT ILIKE '%' || v_clean_search || '%' OR
              o.customer_phone ILIKE '%' || v_clean_search || '%' OR
              unaccent(o.coupon_code) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(o.tracking_code) ILIKE unaccent('%' || v_clean_search || '%') OR
              EXISTS (
                  SELECT 1 FROM public.marketplace_order_items oi
                  WHERE oi.order_id = o.id 
                    AND unaccent(oi.product_name) ILIKE unaccent('%' || v_clean_search || '%')
              )
            )
          )
        ORDER BY o.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;

-- Function: get_admin_products_paged
CREATE OR REPLACE FUNCTION public.get_admin_products_paged(
    p_search TEXT DEFAULT ''::TEXT,
    p_category TEXT DEFAULT 'all'::TEXT,
    p_status TEXT DEFAULT 'all'::TEXT,
    p_stock TEXT DEFAULT 'all'::TEXT,
    p_page INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Compute total count with filters (before pagination)
    SELECT COUNT(p.id) INTO v_total_count
    FROM public.produtos p
    WHERE p.deleted_at IS NULL
      AND (p_category = 'all' OR p.categoria = p_category)
      AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
      AND (p_stock = 'all' OR (p_stock = 'low' AND p.estoque <= 5))
      AND (
        v_clean_search = '' OR (
          unaccent(p.nome) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            p.*,
            (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(v.*)),
                    '[]'::JSONB
                )
                FROM public.product_variants v
                WHERE v.product_id = p.id
            ) AS product_variants
        FROM public.produtos p
        WHERE p.deleted_at IS NULL
          AND (p_category = 'all' OR p.categoria = p_category)
          AND (p_status = 'all' OR (p_status = 'active' AND p.ativo = TRUE) OR (p_status = 'inactive' AND p.ativo = FALSE))
          AND (p_stock = 'all' OR (p_stock = 'low' AND p.estoque <= 5))
          AND (
            v_clean_search = '' OR (
              unaccent(p.nome) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.codigo) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY p.data_cadastro DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;

-- Function: get_admin_customers_paged
CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(
    p_search TEXT DEFAULT ''::TEXT,
    p_sort_field TEXT DEFAULT 'created_at'::TEXT,
    p_sort_direction TEXT DEFAULT 'desc'::TEXT,
    p_page INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

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

    -- CTE to gather aggregated stats per customer with unaccent filtering
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
            v_clean_search = '' OR (
                unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR 
                unaccent(u.email) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(u.phone) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(p.whatsapp) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.city) ILIKE unaccent('%' || v_clean_search || '%') OR
                unaccent(addr.state) ILIKE unaccent('%' || v_clean_search || '%')
            )
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
            -- Numeric ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE 
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE 
                    WHEN p_sort_field = 'total_spent' THEN total_spent
                    WHEN p_sort_field = 'orders_count' THEN orders_count::NUMERIC
                    ELSE NULL
                END
            END DESC,
            -- Temporal ordering
            CASE WHEN p_sort_direction = 'asc' THEN
                CASE 
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END ASC,
            CASE WHEN p_sort_direction = 'desc' THEN
                CASE 
                    WHEN p_sort_field = 'created_at' THEN created_at
                    WHEN p_sort_field = 'last_order_date' THEN last_order_date
                    ELSE NULL
                END
            END DESC
    )
    SELECT 
        COUNT(*) INTO v_total_count 
    FROM sorted_data;

    SELECT COALESCE(
        jsonb_agg(t), 
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT * 
        FROM sorted_data
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'stats', v_stats
    );
END;
$$;

-- Function: get_admin_questions_paged
CREATE OR REPLACE FUNCTION public.get_admin_questions_paged(
    p_search TEXT DEFAULT ''::TEXT,
    p_filter TEXT DEFAULT 'all'::TEXT,
    p_page INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);

    -- Compute total count with filters (before pagination)
    SELECT COUNT(q.id) INTO v_total_count
    FROM public.questions q
    LEFT JOIN public.profiles p ON p.id = q.user_id
    LEFT JOIN public.produtos prod ON prod.id = q.product_id
    WHERE (p_filter = 'all' OR NOT EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id))
      AND (
        v_clean_search = '' OR (
          unaccent(q.question) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            q.*,
            (
                SELECT jsonb_build_object('full_name', p.full_name, 'avatar_url', p.avatar_url)
                FROM public.profiles p
                WHERE p.id = q.user_id
            ) AS "user",
            (
                SELECT jsonb_build_object('nome', prod.nome, 'imagem_url', prod.imagem_url)
                FROM public.produtos prod
                WHERE prod.id = q.product_id
            ) AS "product",
            (
                SELECT COALESCE(
                    jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at ASC),
                    '[]'::JSONB
                )
                FROM public.answers a
                WHERE a.question_id = q.id
            ) AS answers,
            EXISTS (
                SELECT 1 
                FROM public.marketplace_orders o
                JOIN public.marketplace_order_items oi ON oi.order_id = o.id
                WHERE o.user_id = q.user_id
                  AND o.status = 'delivered'
                  AND oi.product_id = q.product_id
            ) AS is_verified
        FROM public.questions q
        LEFT JOIN public.profiles p ON p.id = q.user_id
        LEFT JOIN public.produtos prod ON prod.id = q.product_id
        WHERE (p_filter = 'all' OR NOT EXISTS (SELECT 1 FROM public.answers a WHERE a.question_id = q.id))
          AND (
            v_clean_search = '' OR (
              unaccent(q.question) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY q.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );
END;
$$;

-- Function: get_admin_reviews_paged
CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(
    p_search TEXT DEFAULT ''::TEXT,
    p_rating TEXT DEFAULT 'all'::TEXT,
    p_page INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_total_count BIGINT;
    v_data JSONB;
    v_offset INTEGER;
    v_clean_search TEXT;
    v_rating_val INTEGER;
    
    -- Metrics
    v_average_rating NUMERIC;
    v_total_verified BIGINT;
    v_total_replied BIGINT;
BEGIN
    -- Authorization check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    v_offset := p_page * p_page_size;
    v_clean_search := TRIM(p_search);
    
    IF p_rating = 'all' THEN
        v_rating_val := NULL;
    ELSE
        v_rating_val := p_rating::INTEGER;
    END IF;

    -- Compute total count and metrics in a single query block
    SELECT 
        COUNT(r.id),
        COALESCE(AVG(r.rating), 0.0),
        COUNT(CASE WHEN r.verified = true THEN 1 END),
        COUNT(CASE WHEN r.merchant_reply IS NOT NULL AND TRIM(r.merchant_reply) <> '' THEN 1 END)
    INTO 
        v_total_count,
        v_average_rating,
        v_total_verified,
        v_total_replied
    FROM public.reviews r
    LEFT JOIN public.profiles p ON p.id = r.user_id
    LEFT JOIN public.produtos prod ON prod.id = r.product_id
    WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
      AND (
        v_clean_search = '' OR (
          unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
          unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
        )
      );

    -- Fetch paginated data
    SELECT COALESCE(
        jsonb_agg(t),
        '[]'::JSONB
    ) INTO v_data
    FROM (
        SELECT 
            r.*,
            (
                SELECT jsonb_build_object('full_name', p.full_name)
                FROM public.profiles p
                WHERE p.id = r.user_id
            ) AS "user",
            (
                SELECT jsonb_build_object('nome', prod.nome)
                FROM public.produtos prod
                WHERE prod.id = r.product_id
            ) AS "product"
        FROM public.reviews r
        LEFT JOIN public.profiles p ON p.id = r.user_id
        LEFT JOIN public.produtos prod ON prod.id = r.product_id
        WHERE (v_rating_val IS NULL OR r.rating = v_rating_val)
          AND (
            v_clean_search = '' OR (
              unaccent(r.comment) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(p.full_name) ILIKE unaccent('%' || v_clean_search || '%') OR
              unaccent(prod.nome) ILIKE unaccent('%' || v_clean_search || '%')
            )
          )
        ORDER BY r.created_at DESC
        LIMIT p_page_size
        OFFSET v_offset
    ) t;

    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'average_rating', v_average_rating,
        'total_verified', v_total_verified,
        'total_replied', v_total_replied
    );
END;
$$;


-- ============================================================================
-- 3. REVOKE DEFAULT PUBLIC EXECUTE PRIVILEGES ON RECREATED/CRITICAL FUNCTIONS (Resolves anon_security_definer_function_executable)
-- ============================================================================

-- Search functions (restrict execution to authenticated/service_role roles)
REVOKE EXECUTE ON FUNCTION public.get_admin_orders_paged(text, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_products_paged(text, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_customers_paged(text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_questions_paged(text, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_admin_reviews_paged(text, text, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_admin_orders_paged(text, text, text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_products_paged(text, text, text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_customers_paged(text, text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_questions_paged(text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_reviews_paged(text, text, integer, integer) TO authenticated, service_role;

-- Analytics dashboard function
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_v2(integer) TO authenticated, service_role;

-- Trigger functions (restrict entirely to trigger system/postgres owner)
REVOKE EXECUTE ON FUNCTION public.clean_expired_shipping_quotes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clean_old_shipping_logs() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.clean_expired_shipping_quotes() OWNER TO postgres;
ALTER FUNCTION public.clean_old_shipping_logs() OWNER TO postgres;


-- ============================================================================
-- 4. OPTIMIZE RLS POLICY ON analytics_events FOR PLAN CACHING (Resolves auth_rls_initplan)
-- ============================================================================
DROP POLICY IF EXISTS "analytics_events_insert_policy" ON public.analytics_events;
CREATE POLICY "analytics_events_insert_policy" ON public.analytics_events
    FOR INSERT TO public WITH CHECK (
        ((SELECT auth.uid()) IS NULL AND user_id IS NULL) OR 
        ((SELECT auth.uid()) = user_id)
    );


-- ============================================================================
-- 5. TIGHTEN STORAGE SELECT POLICIES TO PREVENT FILE LISTING (Resolves public_bucket_allows_listing)
-- ============================================================================
DROP POLICY IF EXISTS "Public Read Banners Bucket" ON storage.objects;
DROP POLICY IF EXISTS "Public Display" ON storage.objects;
DROP POLICY IF EXISTS "Public Read Access" ON storage.objects;

CREATE POLICY "Public Read Banners Bucket" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'banners');

CREATE POLICY "Public Display" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'products');

CREATE POLICY "Public Read Access" ON storage.objects
    FOR SELECT TO authenticated USING (bucket_id = 'produtos');

COMMIT;
