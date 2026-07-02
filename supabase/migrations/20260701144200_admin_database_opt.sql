-- Migration: Admin Database Optimization
-- Description: Creates covering indexes for foreign keys highlighted by the Supabase performance advisor and refactors core RLS policies to use optimized User Context subqueries ((SELECT auth.uid())).

-- 1. COVERING INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_marketplace_order_history_created_by ON public.marketplace_order_history(created_by);
CREATE INDEX IF NOT EXISTS idx_marketplace_order_history_order_id ON public.marketplace_order_history(order_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_order_items_variant_id ON public.marketplace_order_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_address_id ON public.marketplace_orders(address_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_coupon_id ON public.marketplace_orders(coupon_id);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON public.user_addresses(user_id);

-- 2. RLS POLICY SUBQUERY OPTIMIZATION
-- Optimization: Replacing auth.uid() with (SELECT auth.uid()) prevents O(N) evaluation on row scans.

-- Table: public.marketplace_orders
DROP POLICY IF EXISTS "Users can only see their own marketplace orders" ON public.marketplace_orders;
CREATE POLICY "Users can only see their own marketplace orders" 
ON public.marketplace_orders FOR SELECT 
TO authenticated 
USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Order visibility" ON public.marketplace_orders;
CREATE POLICY "Order visibility" ON public.marketplace_orders
FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "marketplace_orders_select_policy" ON public.marketplace_orders;
CREATE POLICY "marketplace_orders_select_policy"
ON public.marketplace_orders FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Order management" ON public.marketplace_orders;
CREATE POLICY "Order management" ON public.marketplace_orders
FOR ALL TO authenticated
USING ((SELECT auth.uid()) = user_id OR public.is_admin())
WITH CHECK ((SELECT auth.uid()) = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Owners and Admins update orders" ON public.marketplace_orders;
CREATE POLICY "Owners and Admins update orders" ON public.marketplace_orders
FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = user_id OR public.is_admin())
WITH CHECK ((SELECT auth.uid()) = user_id OR public.is_admin());

-- Table: public.marketplace_order_items
DROP POLICY IF EXISTS "Users can only see their own marketplace order items" ON public.marketplace_order_items;
CREATE POLICY "Users can only see their own marketplace order items" 
ON public.marketplace_order_items FOR SELECT 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM public.marketplace_orders 
    WHERE public.marketplace_orders.id = public.marketplace_order_items.order_id 
    AND public.marketplace_orders.user_id = (SELECT auth.uid())
  )
);

-- Table: public.user_addresses
DROP POLICY IF EXISTS "Address management" ON public.user_addresses;
CREATE POLICY "Address management" ON public.user_addresses
FOR ALL TO authenticated
USING ((SELECT auth.uid()) = user_id OR public.is_admin())
WITH CHECK ((SELECT auth.uid()) = user_id OR public.is_admin());

-- Table: public.profiles
DROP POLICY IF EXISTS "Profiles are viewable by owner or admin" ON public.profiles;
CREATE POLICY "Profiles are viewable by owner or admin" ON public.profiles
FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = id OR public.is_admin());

DROP POLICY IF EXISTS "Profiles self-update secure" ON public.profiles;
CREATE POLICY "Profiles self-update secure" ON public.profiles
FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);

-- Table: public.questions
DROP POLICY IF EXISTS "Users can create questions" ON public.questions;
CREATE POLICY "Users can create questions" ON public.questions
FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) = user_id);
