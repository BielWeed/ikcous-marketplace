-- Migration: Consolidate RLS policies for marketplace_orders
-- Date: 2026-03-04 (Simulated 2026-03-13 for sequence)

BEGIN;

-- 1. Clean up old redundant policies
DROP POLICY IF EXISTS "Admins full access on orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "DML Orders: Admin Only" ON public.marketplace_orders;
DROP POLICY IF EXISTS "No direct deletes on orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Owners and Admins view orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Select Orders: Owner or Admin" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can see own orders or admins" ON public.marketplace_orders;

-- 2. Create optimized Policies
-- SELECT: Users view own orders, Admins view all.
CREATE POLICY "marketplace_orders_select_policy"
ON public.marketplace_orders
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_admin());

-- INSERT: Handled by SECURITY DEFINER RPC create_marketplace_order_v14.
-- No direct inserts allowed for authenticated users without RPC to ensure business rules.
-- (However, the RPC runs as owner, so RLS on INSERT is typically bypassed by the RPC itself).
-- If we want to allow direct insert, we'd need a policy, but we prefer RPC.

-- UPDATE/ALL (Admin only): Only admins can update status or modify orders manually.
CREATE POLICY "marketplace_orders_admin_all_policy"
ON public.marketplace_orders
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

COMMIT;
