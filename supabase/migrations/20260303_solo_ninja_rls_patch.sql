-- 20260303_solo_ninja_rls_patch.sql

-- 1. Fix Data Exposure on Coupons
-- The 'Public Read Coupons' policy allowed fetching ALL coupons including inactive/hidden ones.
-- We must drop it and ensure only 'Public view active coupons' exists for public.
DROP POLICY IF EXISTS "Public Read Coupons" ON public.coupons;

-- Ensure Admins can read all
DROP POLICY IF EXISTS "Admins can view all coupons" ON public.coupons;
CREATE POLICY "Admins can view all coupons" 
ON public.coupons 
FOR SELECT 
USING (is_admin());

-- 2. Fix BOLA / Direct Insert Bypass on Orders
-- The 'Public can insert orders' policy allows any user to insert an order directly,
-- bypassing the secure create_marketplace_order_v2 RPC which validates prices.
-- We must drop ALL public insert policies on marketplace_orders.
DROP POLICY IF EXISTS "Public can insert orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Enable insert for authenticated and anon" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can create own orders" ON public.marketplace_orders;

-- We don't need any INSERT policies for users, because create_marketplace_order_v2 
-- is SECURITY DEFINER and executes with DB owner privileges.
-- We only need to allow admins to insert if necessary, but RPC is preferred.
DROP POLICY IF EXISTS "Admin insert orders" ON public.marketplace_orders;
CREATE POLICY "Admin insert orders" 
ON public.marketplace_orders 
FOR INSERT 
WITH CHECK (is_admin());
