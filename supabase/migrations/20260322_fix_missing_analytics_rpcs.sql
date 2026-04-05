-- Migration: Add Missing Analytics RPCs
-- Date: 2026-03-12
-- Author: Antigravity

BEGIN;

-- 1. get_category_sales
-- Returns category sales data for a given date range
-- Expected by frontend in useAnalytics.ts
CREATE OR REPLACE FUNCTION public.get_category_sales(start_date TEXT, end_date TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSON;
BEGIN
    -- Security Check
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

    SELECT json_agg(t) INTO result
    FROM (
        SELECT 
            COALESCE(p.categoria, 'Sem Categoria') as category,
            SUM(oi.quantity * oi.price)::NUMERIC as value
        FROM public.marketplace_orders o
        JOIN public.marketplace_order_items oi ON o.id = oi.order_id
        JOIN public.produtos p ON p.id = oi.product_id
        WHERE o.created_at >= start_date::TIMESTAMPTZ 
          AND o.created_at <= end_date::TIMESTAMPTZ
          AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY p.categoria
        ORDER BY value DESC
    ) t;

    RETURN COALESCE(result, '[]'::json);
END;
$$;

-- 2. Ensure get_retention_rate is available and correct
CREATE OR REPLACE FUNCTION public.get_retention_rate()
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    total_customers bigint := 0;
    repeated_customers bigint := 0;
    retention_rate numeric := 0;
BEGIN
    -- Security Check
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Acesso negado: privilégios de administrador necessários.';
    END IF;

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
$$;

-- 3. Grant permissions
GRANT EXECUTE ON FUNCTION public.get_category_sales(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_retention_rate() TO authenticated;

COMMIT;
