-- 20260310_fix_bola_rls_history_and_categories.sql
-- Solo-Ninja Security Protocol: IDOR/BOLA Fixes

BEGIN;

-- 1. FIX BOLA ON marketplace_order_history
ALTER TABLE public.marketplace_order_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (defense in depth)
DROP POLICY IF EXISTS "Users can view history of their orders" ON public.marketplace_order_history;
DROP POLICY IF EXISTS "Admins have full access to order history" ON public.marketplace_order_history;

-- Policy: Admin Full Access
CREATE POLICY "Admins have full access to order history"
ON public.marketplace_order_history
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Policy: Users can view their own order history
CREATE POLICY "Users can view history of their orders"
ON public.marketplace_order_history
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.marketplace_orders mo
        WHERE mo.id = marketplace_order_history.order_id
        AND mo.user_id = auth.uid()
    )
);

-- 2. FIX MISSING INSERT/UPDATE/DELETE RLS ON categorias
DROP POLICY IF EXISTS "Admins full access on categorias" ON public.categorias;

CREATE POLICY "Admins full access on categorias"
ON public.categorias
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

COMMIT;
