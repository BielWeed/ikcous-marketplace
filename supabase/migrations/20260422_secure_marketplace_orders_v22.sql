-- Security Hardening: Price Tampering and Unauthorized Access Prevention
-- This patch revokes legacy vulnerable RPCs and ensures v22 is correctly granted.

DO $$ 
BEGIN
    -- 1. Revoke access to the legacy vulnerable RPC (without amount validation)
    BEGIN
        REVOKE ALL ON FUNCTION public.create_marketplace_order(jsonb, text, uuid, text, text, text, text) FROM public, authenticated, anon;
        RAISE NOTICE 'Revoked create_marketplace_order';
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Could not revoke create_marketplace_order (might not exist with this signature)';
    END;

    -- 2. Grant access specifically to the versioned RPC with validation
    BEGIN
        GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v22(jsonb, numeric, numeric, text, uuid, text, text, text, text) TO authenticated;
        RAISE NOTICE 'Granted create_marketplace_order_v22';
    EXCEPTION WHEN OTHERS THEN 
        RAISE NOTICE 'Could not grant create_marketplace_order_v22 (is it defined yet?)';
    END;

    -- 3. Ensure RLS is enabled and restrictive for marketplace_orders
    ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can only see their own marketplace orders" ON public.marketplace_orders;
    CREATE POLICY "Users can only see their own marketplace orders" 
    ON public.marketplace_orders FOR SELECT 
    TO authenticated 
    USING (auth.uid() = user_id);

    -- 4. Ensure RLS for marketplace_order_items (via orders relationship)
    ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can only see their own marketplace order items" ON public.marketplace_order_items;
    CREATE POLICY "Users can only see their own marketplace order items" 
    ON public.marketplace_order_items FOR SELECT 
    TO authenticated 
    USING (
      EXISTS (
        SELECT 1 FROM public.marketplace_orders 
        WHERE public.marketplace_orders.id = public.marketplace_order_items.order_id 
        AND public.marketplace_orders.user_id = auth.uid()
      )
    );

    RAISE NOTICE 'Security Hardening v22 completed successfully';
END $$;
