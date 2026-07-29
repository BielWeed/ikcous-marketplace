-- Migration: Consolidate RLS policies and optimize indexes
-- Date: 2026-07-06

BEGIN;

-- ============================================================================
-- 1. CLEAN UP REDUNDANT POLICIES & CONSOLIDATE RLS
-- ============================================================================

-- Table: public.answers
DROP POLICY IF EXISTS "Answers are viewable by everyone" ON public.answers;
DROP POLICY IF EXISTS "Only admins can manage answers" ON public.answers;
DROP POLICY IF EXISTS answers_select_policy ON public.answers;
DROP POLICY IF EXISTS answers_all_policy ON public.answers;
DROP POLICY IF EXISTS "Public can read answers" ON public.answers;
DROP POLICY IF EXISTS public_view_answers ON public.answers;
DROP POLICY IF EXISTS admin_manage_answers ON public.answers;
DROP POLICY IF EXISTS admin_insert_answers ON public.answers;
DROP POLICY IF EXISTS "Public view answers" ON public.answers;
DROP POLICY IF EXISTS "Admins manage answers" ON public.answers;
DROP POLICY IF EXISTS "Admins only insert answers" ON public.answers;

CREATE POLICY answers_select_policy ON public.answers
FOR SELECT TO public USING (true);
CREATE POLICY answers_admin_all_policy ON public.answers
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.banners
DROP POLICY IF EXISTS "Admins manage banners" ON public.banners;
DROP POLICY IF EXISTS "Admins only delete banners" ON public.banners;
DROP POLICY IF EXISTS admin_delete_banners ON public.banners;
DROP POLICY IF EXISTS "Admins only insert banners" ON public.banners;
DROP POLICY IF EXISTS admin_insert_banners ON public.banners;
DROP POLICY IF EXISTS "Public can read banners" ON public.banners;
DROP POLICY IF EXISTS "Admins can view all banners" ON public.banners;
DROP POLICY IF EXISTS "Public Read Banners" ON public.banners;
DROP POLICY IF EXISTS "Public can view active banners" ON public.banners;
DROP POLICY IF EXISTS admin_update_banners ON public.banners;
DROP POLICY IF EXISTS "Admins only update banners" ON public.banners;

CREATE POLICY banners_select_policy ON public.banners
FOR SELECT TO public USING (
    active = true OR (auth.role() = 'authenticated' AND public.is_admin())
);
CREATE POLICY banners_admin_all_policy ON public.banners
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.coupons
DROP POLICY IF EXISTS "Admins full access on coupons" ON public.coupons;
DROP POLICY IF EXISTS "Admins only delete coupons" ON public.coupons;
DROP POLICY IF EXISTS admin_delete_coupons ON public.coupons;
DROP POLICY IF EXISTS "Admins only insert coupons" ON public.coupons;
DROP POLICY IF EXISTS admin_insert_coupons ON public.coupons;
DROP POLICY IF EXISTS "Anyone can view active coupons" ON public.coupons;
DROP POLICY IF EXISTS "Public Read Coupons" ON public.coupons;
DROP POLICY IF EXISTS "Admins can view all coupons" ON public.coupons;
DROP POLICY IF EXISTS admin_update_coupons ON public.coupons;
DROP POLICY IF EXISTS "Admins only update coupons" ON public.coupons;

CREATE POLICY coupons_select_policy ON public.coupons
FOR SELECT TO public USING (
    active = true OR (auth.role() = 'authenticated' AND public.is_admin())
);
CREATE POLICY coupons_admin_all_policy ON public.coupons
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.product_variants
DROP POLICY IF EXISTS "Admins full access on product variants" ON public.product_variants;
DROP POLICY IF EXISTS "Admins can delete variants" ON public.product_variants;
DROP POLICY IF EXISTS "Admins can insert variants" ON public.product_variants;
DROP POLICY IF EXISTS "Public can view active variants" ON public.product_variants;
DROP POLICY IF EXISTS "Admins can view all variants" ON public.product_variants;
DROP POLICY IF EXISTS "Admins can update variants" ON public.product_variants;

CREATE POLICY product_variants_select_policy ON public.product_variants
FOR SELECT TO public USING (true);
CREATE POLICY product_variants_admin_all_policy ON public.product_variants
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.produtos
DROP POLICY IF EXISTS "Admins full access on products" ON public.produtos;
DROP POLICY IF EXISTS "Admins can delete produtos" ON public.produtos;
DROP POLICY IF EXISTS "Admins can insert produtos" ON public.produtos;
DROP POLICY IF EXISTS "Admins can view all produtos" ON public.produtos;
DROP POLICY IF EXISTS "Public can view active produtos" ON public.produtos;
DROP POLICY IF EXISTS "Admins can update produtos" ON public.produtos;

CREATE POLICY produtos_select_policy ON public.produtos
FOR SELECT TO public USING (
    ativo = true OR (auth.role() = 'authenticated' AND public.is_admin())
);
CREATE POLICY produtos_admin_all_policy ON public.produtos
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.questions
DROP POLICY IF EXISTS questions_delete_policy ON public.questions;
DROP POLICY IF EXISTS admin_delete_questions ON public.questions;
DROP POLICY IF EXISTS questions_insert_policy ON public.questions;
DROP POLICY IF EXISTS "Questions are viewable by everyone" ON public.questions;
DROP POLICY IF EXISTS "Public view QA" ON public.questions;
DROP POLICY IF EXISTS public_view_questions ON public.questions;
DROP POLICY IF EXISTS questions_select_policy ON public.questions;
DROP POLICY IF EXISTS questions_update_policy ON public.questions;

CREATE POLICY questions_select_policy ON public.questions
FOR SELECT TO public USING (true);
CREATE POLICY questions_insert_policy ON public.questions
FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT null);
CREATE POLICY questions_admin_all_policy ON public.questions
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.reviews
DROP POLICY IF EXISTS admin_delete_reviews ON public.reviews;
DROP POLICY IF EXISTS "Admins can delete any review" ON public.reviews;
DROP POLICY IF EXISTS reviews_delete_policy ON public.reviews;
DROP POLICY IF EXISTS reviews_insert_policy ON public.reviews;
DROP POLICY IF EXISTS public_view_reviews ON public.reviews;
DROP POLICY IF EXISTS "Public read reviews" ON public.reviews;
DROP POLICY IF EXISTS reviews_select_policy ON public.reviews;
DROP POLICY IF EXISTS reviews_update_policy ON public.reviews;

CREATE POLICY reviews_select_policy ON public.reviews
FOR SELECT TO public USING (true);
CREATE POLICY reviews_insert_policy ON public.reviews
FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT null);
CREATE POLICY reviews_admin_all_policy ON public.reviews
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.marketplace_orders
DROP POLICY IF EXISTS orders_all_policy ON public.marketplace_orders;
DROP POLICY IF EXISTS marketplace_orders_admin_all_policy ON public.marketplace_orders;
DROP POLICY IF EXISTS "DML Orders: Admin Only" ON public.marketplace_orders;
DROP POLICY IF EXISTS "No direct deletes on orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS "Admins can update orders" ON public.marketplace_orders;
DROP POLICY IF EXISTS marketplace_orders_select_policy ON public.marketplace_orders;

CREATE POLICY marketplace_orders_select_policy ON public.marketplace_orders
FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY marketplace_orders_admin_all_policy ON public.marketplace_orders
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- ============================================================================
-- 2. INDEX OPTIMIZATION
-- ============================================================================

-- Create missing index on FK
CREATE INDEX IF NOT EXISTS idx_push_notifications_log_created_by ON public.push_notifications_log (
    created_by
);

-- Clean up verified unused indexes
DROP INDEX IF EXISTS idx_banners_active_order;
DROP INDEX IF EXISTS idx_push_subs_created_at;
DROP INDEX IF EXISTS idx_marketplace_order_history_created_by;
DROP INDEX IF EXISTS idx_marketplace_order_history_order_id;
DROP INDEX IF EXISTS idx_marketplace_order_items_variant_id;
DROP INDEX IF EXISTS idx_marketplace_orders_address_id;
DROP INDEX IF EXISTS idx_marketplace_orders_coupon_id;
DROP INDEX IF EXISTS idx_user_addresses_user_id;
DROP INDEX IF EXISTS idx_produtos_fornecedor_id;
DROP INDEX IF EXISTS idx_profiles_company_id;
DROP INDEX IF EXISTS idx_analytics_events_user_id;
DROP INDEX IF EXISTS idx_push_subscriptions_user_id;
DROP INDEX IF EXISTS idx_marketplace_orders_user_id;
DROP INDEX IF EXISTS idx_otp_email;

COMMIT;
