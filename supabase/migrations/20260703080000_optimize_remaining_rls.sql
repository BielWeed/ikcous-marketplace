-- Migration: Optimize Remaining RLS Policies
-- Description: Consolidated cleanup of all redundant, duplicate RLS policies and optimization of auth.uid() to (SELECT auth.uid()) to avoid row-by-row scans.

-- 1. OPTIMIZE is_admin() FUNCTION
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
    AND role = 'admin'
  );
END;
$$;

-- 2. CLEANUP EXISTING RLS POLICIES

-- Table: public.profiles
DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by self or admin" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by owner or admin" ON public.profiles;
DROP POLICY IF EXISTS "Profiles self-update secure" ON public.profiles;

-- Table: public.user_addresses
DROP POLICY IF EXISTS user_addresses_select_policy ON public.user_addresses;
DROP POLICY IF EXISTS user_addresses_insert_policy ON public.user_addresses;
DROP POLICY IF EXISTS user_addresses_update_policy ON public.user_addresses;
DROP POLICY IF EXISTS user_addresses_delete_policy ON public.user_addresses;
DROP POLICY IF EXISTS "Address management" ON public.user_addresses;

-- Table: public.cart_items
DROP POLICY IF EXISTS "Users can manage their own cart items" ON public.cart_items;

-- Table: public.favorites
DROP POLICY IF EXISTS "Manage own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can view their own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can insert their own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can update their own favorites" ON public.favorites;
DROP POLICY IF EXISTS "Users can delete their own favorites" ON public.favorites;

-- Table: public.reviews
DROP POLICY IF EXISTS "Manage own reviews" ON public.reviews;
DROP POLICY IF EXISTS auth_insert_reviews ON public.reviews;
DROP POLICY IF EXISTS owner_admin_update_reviews ON public.reviews;
DROP POLICY IF EXISTS "Users can delete own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can delete their own reviews" ON public.reviews;

-- Table: public.questions
DROP POLICY IF EXISTS auth_insert_questions ON public.questions;
DROP POLICY IF EXISTS owner_admin_update_questions ON public.questions;
DROP POLICY IF EXISTS "Users can delete own questions" ON public.questions;
DROP POLICY IF EXISTS "Users ask questions" ON public.questions;
DROP POLICY IF EXISTS "Users can create questions" ON public.questions;

-- Table: public.answers
DROP POLICY IF EXISTS "Admins/Owners delete answers" ON public.answers;
DROP POLICY IF EXISTS "answers_select_policy" ON public.answers;
DROP POLICY IF EXISTS "answers_all_policy" ON public.answers;

-- Table: public.notificacoes
DROP POLICY IF EXISTS "Users view own notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "Users read own notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "Users update own notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "Users can read own or global notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notificacoes;
DROP POLICY IF EXISTS "Final notification protection" ON public.notificacoes;

-- Table: public.push_subscriptions
DROP POLICY IF EXISTS push_subscriptions_owner_policy ON public.push_subscriptions;
DROP POLICY IF EXISTS "Admins view subscriptions" ON public.push_subscriptions;

-- Table: public.marketplace_orders
DROP POLICY IF EXISTS "Users can only see their own marketplace orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can view their own orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Order visibility" ON public.marketplace_orders;
DROP POLICY IF EXISTS marketplace_orders_select_policy ON public.marketplace_orders;
DROP POLICY IF EXISTS "Select Orders: Owner or Admin" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Users can see own orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Order management" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Owners and Admins update orders" ON public.marketplace_orders;

-- Table: public.marketplace_order_items
DROP POLICY IF EXISTS order_items_select_policy ON public.marketplace_order_items;
DROP POLICY IF EXISTS "Users can view their own order items" ON public.marketplace_order_items;
DROP POLICY IF EXISTS "Users can only see their own marketplace order items" ON public.marketplace_order_items;

-- Table: public.marketplace_order_history
DROP POLICY IF EXISTS order_history_select_policy ON public.marketplace_order_history;

-- Table: public.analytics_events
DROP POLICY IF EXISTS public_insert_analytics ON public.analytics_events;
DROP POLICY IF EXISTS auth_insert_analytics ON public.analytics_events;

-- Table: public.vor_receipts
DROP POLICY IF EXISTS "Admins can insert VOR receipts" ON public.vor_receipts;


-- 3. RECREATE CONSOLIDATED & OPTIMIZED RLS POLICIES

-- public.profiles
CREATE POLICY "profiles_select_policy" ON public.profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id OR public.is_admin());
CREATE POLICY "profiles_update_policy" ON public.profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = id OR public.is_admin()) WITH CHECK ((SELECT auth.uid()) = id OR public.is_admin());

-- public.user_addresses
CREATE POLICY "user_addresses_all_policy" ON public.user_addresses FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id OR public.is_admin()) WITH CHECK ((SELECT auth.uid()) = user_id OR public.is_admin());

-- public.cart_items
CREATE POLICY "cart_items_all_policy" ON public.cart_items FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

-- public.favorites
CREATE POLICY "favorites_all_policy" ON public.favorites FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

-- public.reviews
CREATE POLICY "reviews_select_policy" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert_policy" ON public.reviews FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "reviews_update_policy" ON public.reviews FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id OR public.is_admin()) WITH CHECK ((SELECT auth.uid()) = user_id OR public.is_admin());
CREATE POLICY "reviews_delete_policy" ON public.reviews FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id OR public.is_admin());

-- public.questions
CREATE POLICY "questions_select_policy" ON public.questions FOR SELECT USING (true);
CREATE POLICY "questions_insert_policy" ON public.questions FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "questions_update_policy" ON public.questions FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id OR public.is_admin()) WITH CHECK ((SELECT auth.uid()) = user_id OR public.is_admin());
CREATE POLICY "questions_delete_policy" ON public.questions FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id OR public.is_admin());

-- public.answers
CREATE POLICY "answers_select_policy" ON public.answers FOR SELECT USING (true);
CREATE POLICY "answers_all_policy" ON public.answers FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- public.notificacoes
CREATE POLICY "notificacoes_select_policy" ON public.notificacoes FOR SELECT TO authenticated USING ((SELECT auth.uid()) = usuario_id OR usuario_id IS NULL OR public.is_admin());
CREATE POLICY "notificacoes_insert_policy" ON public.notificacoes FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = usuario_id OR public.is_admin());
CREATE POLICY "notificacoes_update_policy" ON public.notificacoes FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = usuario_id OR public.is_admin()) WITH CHECK ((SELECT auth.uid()) = usuario_id OR public.is_admin());
CREATE POLICY "notificacoes_delete_policy" ON public.notificacoes FOR DELETE TO authenticated USING ((SELECT auth.uid()) = usuario_id OR public.is_admin());

-- public.push_subscriptions
CREATE POLICY "push_subscriptions_all_policy" ON public.push_subscriptions FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id OR public.is_admin()) WITH CHECK ((SELECT auth.uid()) = user_id OR public.is_admin());

-- public.marketplace_orders
CREATE POLICY "orders_all_policy" ON public.marketplace_orders FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id OR public.is_admin()) WITH CHECK ((SELECT auth.uid()) = user_id OR public.is_admin());

-- public.marketplace_order_items
CREATE POLICY "order_items_all_policy" ON public.marketplace_order_items FOR ALL TO authenticated USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.marketplace_orders mo WHERE mo.id = order_id AND mo.user_id = (SELECT auth.uid()))) WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.marketplace_orders mo WHERE mo.id = order_id AND mo.user_id = (SELECT auth.uid())));

-- public.marketplace_order_history
CREATE POLICY "order_history_all_policy" ON public.marketplace_order_history FOR ALL TO authenticated USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.marketplace_orders mo WHERE mo.id = order_id AND mo.user_id = (SELECT auth.uid()))) WITH CHECK (public.is_admin() OR EXISTS (SELECT 1 FROM public.marketplace_orders mo WHERE mo.id = order_id AND mo.user_id = (SELECT auth.uid())));

-- public.analytics_events
CREATE POLICY "analytics_events_insert_policy" ON public.analytics_events FOR INSERT WITH CHECK (true);

-- public.vor_receipts
CREATE POLICY "vor_receipts_insert_policy" ON public.vor_receipts FOR INSERT TO authenticated WITH CHECK (public.is_admin());
