-- Migration: Clean up legacy, duplicate, and unoptimized RLS policies
-- Date: 2026-07-09
-- Version: 20260709001500

BEGIN;

-- 1. Table: public.answers
DROP POLICY IF EXISTS admin_only_insert_answers ON public.answers;


-- 2. Table: public.coupons
DROP POLICY IF EXISTS "Public can view active coupons" ON public.coupons;
DROP POLICY IF EXISTS "Public view active coupons" ON public.coupons;
DROP POLICY IF EXISTS "Users view active coupons" ON public.coupons;


-- 3. Table: public.favorites
DROP POLICY IF EXISTS "Users can delete their own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can insert their own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can view their own favorites" ON public.favorites;
DROP POLICY IF EXISTS favorites_all_policy ON public.favorites;

CREATE POLICY favorites_all_policy ON public.favorites
FOR ALL TO authenticated USING (((SELECT auth.uid()) = user_id)) WITH CHECK (
    ((SELECT auth.uid()) = user_id)
);


-- 4. Table: public.marketplace_order_history
DROP POLICY IF EXISTS "Admins have full access to order history" ON public.marketplace_order_history;
DROP POLICY IF EXISTS "Admins manage history" ON public.marketplace_order_history;
DROP POLICY IF EXISTS "Owners view order history" ON public.marketplace_order_history;
DROP POLICY IF EXISTS "Users can view history of their orders" ON public.marketplace_order_history;


-- 5. Table: public.marketplace_order_items
DROP POLICY IF EXISTS "Admins full access on order items" ON public.marketplace_order_items;
DROP POLICY IF EXISTS "Admins have ALL access to order items" ON public.marketplace_order_items;
DROP POLICY IF EXISTS "Users can SELECT their own order items" ON public.marketplace_order_items;
DROP POLICY IF EXISTS "Users can view own order items" ON public.marketplace_order_items;


-- 6. Table: public.marketplace_orders
DROP POLICY IF EXISTS "Admin insert orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Admins have ALL access to orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can SELECT their own orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can insert their own orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can view own orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can view their own orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS admin_all_orders ON public.marketplace_orders;
DROP POLICY IF EXISTS authenticated_select_own_orders ON public.marketplace_orders;


-- 7. Table: public.notificacoes
DROP POLICY IF EXISTS authenticated_insert_own_notifications ON public.notificacoes;


-- 8. Table: public.produtos
DROP POLICY IF EXISTS "Produtos are viewable by everyone" ON public.produtos;
DROP POLICY IF EXISTS "Public can view active products" ON public.produtos;


-- 9. Table: public.push_subscriptions
DROP POLICY IF EXISTS users_manage_own_auth_subscriptions ON public.push_subscriptions;


-- 10. Table: public.reviews
DROP POLICY IF EXISTS "Public view reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users review own orders" ON public.reviews;
DROP POLICY IF EXISTS reviews_insert_policy ON public.reviews;
DROP POLICY IF EXISTS reviews_select_policy ON public.reviews;

CREATE POLICY reviews_select_policy ON public.reviews
FOR SELECT TO public USING (true);

CREATE POLICY reviews_insert_policy ON public.reviews
FOR INSERT TO authenticated WITH CHECK (((SELECT auth.uid()) = user_id));


-- 11. Table: public.user_addresses
DROP POLICY IF EXISTS "Admins can manage all addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "Admins full access on addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "Users can delete their own addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "Users can update their own addresses" ON public.user_addresses;
DROP POLICY IF EXISTS "Users can view own addresses" ON public.user_addresses;


-- 12. Table: public.store_config
DROP POLICY IF EXISTS "Admins read base table" ON public.store_config;

COMMIT;
