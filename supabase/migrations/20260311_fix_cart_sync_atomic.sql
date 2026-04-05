-- 20260311_fix_cart_sync_atomic.sql
-- Fix Cart Synchronization RPC to handle NOT NULL variant_id column.
-- Since 20260224_fix_cart_nulls.sql, variant_id is NOT NULL with default ''
-- to satisfy the UNIQUE constraint (user_id, product_id, variant_id).

CREATE OR REPLACE FUNCTION public.sync_cart_atomic(
    p_cart_items JSONB,
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_user_id UUID;
BEGIN
    -- Protection against BOLA
    v_target_user_id := COALESCE(p_user_id, auth.uid());
    IF v_target_user_id <> auth.uid() AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Acesso negado: Tentativa de manipulação de carrinho de outro usuário.';
    END IF;

    -- Begin atomic operation
    -- First, clear the existing cart for this user
    DELETE FROM public.cart_items WHERE user_id = v_target_user_id;

    -- Then, insert the new items if any
    IF jsonb_array_length(p_cart_items) > 0 THEN
        INSERT INTO public.cart_items (
            user_id, product_id, variant_id, quantity, created_at, updated_at
        )
        SELECT 
            v_target_user_id,
            (x->>'product_id'), -- Matches TEXT column type
            COALESCE(x->>'variant_id', ''), -- Matches NOT NULL TEXT column type with '' default
            (x->>'quantity')::INTEGER,
            NOW(),
            NOW()
        FROM jsonb_array_elements(p_cart_items) AS x;
    END IF;

    RETURN jsonb_build_object('success', true, 'synced_items_count', jsonb_array_length(p_cart_items));
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_cart_atomic TO authenticated;
