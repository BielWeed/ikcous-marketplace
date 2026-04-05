-- migrations/20260305_restore_rls_policies.sql
-- RESTORE RLS POLICIES FOR CRITICAL MARKETPLACE TABLES
-- Fixes "default-deny" state caused by missing policies while ensuring strict data separation (BOLA prevention).

BEGIN;

-------------------------------------------------------------------------------
-- 1. produtos (Products)
-- Fix: Prevent public from seeing inactive/hidden products, but allow admins full access
-------------------------------------------------------------------------------
-- Drop permissive/old policies
DROP POLICY IF EXISTS "Produtos are viewable by everyone" ON public.produtos;
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.produtos;

-- Ensure RLS is enabled
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;

-- Public can only view ACTIVE products
CREATE POLICY "Public view active products" 
ON public.produtos 
FOR SELECT 
USING (ativo = true);

-- Admins can do anything
CREATE POLICY "Admins full access on products" 
ON public.produtos 
FOR ALL 
USING (public.is_admin());


-------------------------------------------------------------------------------
-- 2. user_addresses (Addresses)
-- Fix: Currently has NO policies (default deny). Users need to manage their own addresses.
-------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage their own addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "Admins full access on addresses" ON public.user_addresses;

ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own addresses" 
ON public.user_addresses 
FOR ALL 
USING (user_id = auth.uid()) 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins full access on addresses" 
ON public.user_addresses 
FOR ALL 
USING (public.is_admin());


-------------------------------------------------------------------------------
-- 3. marketplace_orders (Orders)
-- Fix: Currently has NO policies (default deny). Users must be able to view their own orders.
-------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Admins full access on orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Public can insert orders" ON public.marketplace_orders;

ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

-- Note: We ONLY grant SELECT. INSERT/UPDATE/DELETE are handled by SECURITY DEFINER RPCs (create_marketplace_order_v5)
-- or restricted to admins to prevent BOLA or skipping payment gateways.
CREATE POLICY "Users can view own orders" 
ON public.marketplace_orders 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Admins full access on orders" 
ON public.marketplace_orders 
FOR ALL 
USING (public.is_admin());


-------------------------------------------------------------------------------
-- 4. marketplace_order_items (Order Items)
-- Fix: Ensure items are only viewable by order owners.
-------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated inserts through orders ownership" ON public.marketplace_order_items;
DROP POLICY IF EXISTS "Users can view own order items" ON public.marketplace_order_items;
DROP POLICY IF EXISTS "Admins full access on order items" ON public.marketplace_order_items;

ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own order items" 
ON public.marketplace_order_items 
FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.marketplace_orders o 
        WHERE o.id = marketplace_order_items.order_id 
        AND o.user_id = auth.uid()
    )
);

CREATE POLICY "Admins full access on order items" 
ON public.marketplace_order_items 
FOR ALL 
USING (public.is_admin());


-------------------------------------------------------------------------------
-- 5. coupons (Coupons)
-- Fix: Missing policies. Public should only be able to view/check active coupons.
-------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public view active coupons" ON public.coupons;
DROP POLICY IF EXISTS "Admins full access on coupons" ON public.coupons;

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public view active coupons" 
ON public.coupons 
FOR SELECT 
USING (active = true);

CREATE POLICY "Admins full access on coupons" 
ON public.coupons 
FOR ALL 
USING (public.is_admin());

-------------------------------------------------------------------------------
-- 6. product_variants (Variants)
-- Fix: Only active variants should be retrieved
-------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view active variants" ON public.product_variants;
DROP POLICY IF EXISTS "Admins full access on variants" ON public.product_variants;

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active variants" 
ON public.product_variants 
FOR SELECT 
USING (
    active = true AND 
    EXISTS (
        SELECT 1 FROM public.produtos p 
        WHERE p.id = product_variants.product_id 
        AND p.ativo = true
    )
);

CREATE POLICY "Admins full access on variants" 
ON public.product_variants 
FOR ALL 
USING (public.is_admin());

COMMIT;
