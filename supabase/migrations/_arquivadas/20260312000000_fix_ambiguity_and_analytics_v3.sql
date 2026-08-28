-- Resolve ambiguity for sync_cart_atomic and fix analytics column references

-- 1. Drop all existing overloaded versions of sync_cart_atomic
DROP FUNCTION IF EXISTS public.sync_cart_atomic(jsonb);
DROP FUNCTION IF EXISTS public.sync_cart_atomic(uuid, jsonb);
DROP FUNCTION IF EXISTS public.sync_cart_atomic(jsonb, uuid);

-- 2. Recreate the canonical version with hardening (grouping and sum)
CREATE OR REPLACE FUNCTION public.sync_cart_atomic(p_cart_items jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Delete existing items
    DELETE FROM public.cart_items
    WHERE user_id = v_user_id;

    -- Insert new items, grouping and summing to prevent duplicates
    INSERT INTO public.cart_items (user_id, product_id, variant_id, quantity)
    SELECT 
        v_user_id,
        (item->>'product_id')::text,
        COALESCE(item->>'variant_id', '')::text,
        SUM((item->>'quantity')::integer)
    FROM jsonb_array_elements(p_cart_items) AS item
    GROUP BY 1, 2, 3;

END;
$$;

-- 3. Fix get_admin_analytics_v2 (reference 'estoque' instead of 'stock')
CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    total_sales numeric;
    total_orders bigint;
    total_products bigint;
    low_stock_count bigint;
    result jsonb;
BEGIN
    -- Check if admin
    IF NOT EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO total_sales, total_orders
    FROM marketplace_orders
    WHERE status != 'cancelled';

    SELECT COUNT(*) INTO total_products FROM produtos WHERE ativo = true;

    -- Fix: Use 'estoque' instead of 'stock'
    SELECT COUNT(*) INTO low_stock_count FROM produtos WHERE estoque <= estoque_minimo AND ativo = true;

    result := jsonb_build_object(
        'total_sales', total_sales,
        'total_orders', total_orders,
        'total_products', total_products,
        'low_stock_count', low_stock_count
    );

    RETURN result;
END;
$$;
