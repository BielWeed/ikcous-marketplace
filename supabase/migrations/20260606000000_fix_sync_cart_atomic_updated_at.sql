-- Fix sync_cart_atomic to accept and persist client-provided updated_at timestamps
-- This is critical for LWW (Last-Write-Wins) conflict resolution in CartContext.tsx
-- Previously, the RPC ignored the client's updated_at and used NOW(), defeating offline sync.

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
    -- and summing quantities if the payload somehow contains the same item twice.
    -- Accept client-provided updated_at for LWW conflict resolution;
    -- fall back to NOW() if the client omits it.
    INSERT INTO public.cart_items (user_id, product_id, variant_id, quantity, updated_at)
    SELECT 
        v_user_id,
        (item->>'product_id')::text,
        COALESCE(item->>'variant_id', '')::text,
        SUM((item->>'quantity')::integer),
        COALESCE(MAX((item->>'updated_at')::timestamptz), NOW())
    FROM jsonb_array_elements(p_cart_items) AS item
    GROUP BY 1, 2, 3;

END;
$$;
