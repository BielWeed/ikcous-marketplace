-- Migration: Add avatar_url to get_admin_questions_paged RPC
-- Created At: 2026-07-08T02:00:00Z
-- Description: Updates get_admin_questions_paged to return user avatar_url.

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

GRANT EXECUTE ON FUNCTION public.get_admin_questions_paged TO authenticated;
