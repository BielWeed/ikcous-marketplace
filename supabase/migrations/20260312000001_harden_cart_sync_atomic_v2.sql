-- Harden sync_cart_atomic to handle duplicate items in the input payload
-- This prevents 409 Conflict errors by grouping items by product and variant
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

    -- Insert new items, grouping by product and variant to prevent duplicates
    -- and summing quantities if the payload somehow contains the same item twice
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
