-- 20260707000000_fix_update_order_status_atomic.sql
-- Goal: Fix signature mismatch for update_order_status_atomic by drop and recreation

BEGIN;

-- Drop existing overloaded signatures to avoid PostgREST conflicts
DROP FUNCTION IF EXISTS public.update_order_status_atomic(
    p_order_id uuid, p_status text
);
DROP FUNCTION IF EXISTS public.update_order_status_atomic(
    p_order_id uuid, p_new_status text, p_notes text
);
DROP FUNCTION IF EXISTS public.update_order_status_atomic(
    p_order_id uuid, p_new_status text, p_notes text, p_silent boolean
);

-- Recreate the full-featured, secure update status function
CREATE OR REPLACE FUNCTION public.update_order_status_atomic(
    p_order_id uuid,
    p_new_status text,
    p_notes text DEFAULT NULL,
    p_silent boolean DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status TEXT;
    v_user_id UUID;
    v_caller_id UUID := auth.uid();
    v_is_admin BOOLEAN := public.is_admin();
    v_item RECORD;
    v_result jsonb;
BEGIN
    -- Get current status and lock row
    SELECT status, user_id INTO v_old_status, v_user_id 
    FROM public.marketplace_orders 
    WHERE id = p_order_id 
    FOR UPDATE;
    
    IF v_old_status IS NULL THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    -- Security checks
    IF v_user_id != v_caller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Não autorizado: Você não tem permissão para alterar este pedido.';
    END IF;

    IF NOT v_is_admin THEN
        IF p_new_status != 'cancelled' THEN
            RAISE EXCEPTION 'Operação não permitida: Usuários só podem cancelar seus próprios pedidos.';
        END IF;
        IF v_old_status != 'pending' THEN
            RAISE EXCEPTION 'Apenas pedidos pendentes podem ser cancelados pelo usuário.';
        END IF;
    END IF;

    -- STOCK RESTORATION LOGIC
    -- If transitioning to 'cancelled' from a non-cancelled status
    IF p_new_status = 'cancelled' AND v_old_status != 'cancelled' THEN
        FOR v_item IN SELECT product_id, variant_id, quantity FROM public.marketplace_order_items WHERE order_id = p_order_id
        LOOP
            IF v_item.variant_id IS NOT NULL THEN
                UPDATE public.product_variants 
                SET stock_increment = stock_increment + v_item.quantity 
                WHERE id = v_item.variant_id;
            ELSE
                UPDATE public.produtos 
                SET estoque = estoque + v_item.quantity 
                WHERE id = v_item.product_id;
            END IF;
        END LOOP;
    END IF;

    -- Update status
    UPDATE public.marketplace_orders 
    SET status = p_new_status, updated_at = NOW() 
    WHERE id = p_order_id
    RETURNING to_jsonb(public.marketplace_orders.*) INTO v_result;

    -- Log history
    INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
    VALUES (p_order_id, v_old_status, p_new_status, p_notes, v_caller_id);

    RETURN v_result;
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.update_order_status_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status_atomic TO anon;

COMMIT;
