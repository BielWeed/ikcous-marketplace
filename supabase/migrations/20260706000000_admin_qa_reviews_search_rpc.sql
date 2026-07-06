-- Migration: Admin Q&A and Reviews Search RPC Optimization
-- Created At: 2026-07-06T00:00:00Z
-- Description: Adds get_admin_questions_paged and get_admin_reviews_paged with accent-insensitive search, joined tables, and aggregated metrics.

BEGIN;

-- 1. Create get_admin_questions_paged RPC
CREATE OR REPLACE FUNCTION public.get_admin_questions_paged(
    p_search TEXT DEFAULT ''::TEXT,
    p_filter TEXT DEFAULT 'all'::TEXT,
    p_page INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
                SELECT jsonb_build_object('full_name', p.full_name)
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

GRANT EXECUTE ON FUNCTION public.get_admin_questions_paged TO authenticated;

-- 2. Create get_admin_reviews_paged RPC
CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(
    p_search TEXT DEFAULT ''::TEXT,
    p_rating TEXT DEFAULT 'all'::TEXT,
    p_page INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.get_admin_reviews_paged TO authenticated;

COMMIT;
