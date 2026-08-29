-- Solo-Ninja Security v18 Polish
BEGIN;

-- 1. Harden profiles RLS
DROP POLICY IF EXISTS "Profiles are viewable by owner or admin" ON public.profiles;
CREATE POLICY "Profiles are viewable by owner or admin"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.is_admin());

-- 2. Verify marketplace_orders for BOLA (Table Level)
-- Ensure that status updates are only possible for the owner OR admin
-- This complements the RPC protection
DROP POLICY IF EXISTS "Users can update their own orders" ON public.marketplace_orders;
CREATE POLICY "Users can update their own orders"
ON public.marketplace_orders
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (auth.uid() = user_id OR public.is_admin());

COMMIT;
