-- Migration: Split ALL RLS Policies to Avoid Permissive Policy Overlaps
-- Date: 2026-07-08
-- Version: 20260708140000

BEGIN;

-- ============================================================================
-- 1. Table: public.answers
-- ============================================================================
DROP POLICY IF EXISTS answers_admin_modify_policy ON public.answers;

CREATE POLICY answers_admin_insert_policy ON public.answers
FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY answers_admin_update_policy ON public.answers
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY answers_admin_delete_policy ON public.answers
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 2. Table: public.banners
-- ============================================================================
DROP POLICY IF EXISTS banners_admin_modify_policy ON public.banners;

CREATE POLICY banners_admin_insert_policy ON public.banners
FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY banners_admin_update_policy ON public.banners
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY banners_admin_delete_policy ON public.banners
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 3. Table: public.categorias
-- ============================================================================
DROP POLICY IF EXISTS categorias_admin_modify_policy ON public.categorias;

CREATE POLICY categorias_admin_insert_policy ON public.categorias
FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY categorias_admin_update_policy ON public.categorias
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY categorias_admin_delete_policy ON public.categorias
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 4. Table: public.coupons
-- ============================================================================
DROP POLICY IF EXISTS coupons_admin_modify_policy ON public.coupons;

CREATE POLICY coupons_admin_insert_policy ON public.coupons
FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY coupons_admin_update_policy ON public.coupons
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY coupons_admin_delete_policy ON public.coupons
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 5. Table: public.marketplace_ai_state
-- ============================================================================
DROP POLICY IF EXISTS marketplace_ai_state_admin_policy ON public.marketplace_ai_state;

CREATE POLICY marketplace_ai_state_admin_select ON public.marketplace_ai_state
FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY marketplace_ai_state_admin_insert ON public.marketplace_ai_state
FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY marketplace_ai_state_admin_update ON public.marketplace_ai_state
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY marketplace_ai_state_admin_delete ON public.marketplace_ai_state
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 6. Table: public.marketplace_orders
-- ============================================================================
DROP POLICY IF EXISTS marketplace_orders_admin_modify_policy ON public.marketplace_orders;

CREATE POLICY marketplace_orders_admin_insert_policy ON public.marketplace_orders
FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY marketplace_orders_admin_update_policy ON public.marketplace_orders
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY marketplace_orders_admin_delete_policy ON public.marketplace_orders
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 7. Table: public.product_variants
-- ============================================================================
DROP POLICY IF EXISTS product_variants_admin_modify_policy ON public.product_variants;

CREATE POLICY product_variants_admin_insert_policy ON public.product_variants
FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY product_variants_admin_update_policy ON public.product_variants
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY product_variants_admin_delete_policy ON public.product_variants
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 8. Table: public.produtos
-- ============================================================================
DROP POLICY IF EXISTS produtos_admin_modify_policy ON public.produtos;

CREATE POLICY produtos_admin_insert_policy ON public.produtos
FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY produtos_admin_update_policy ON public.produtos
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY produtos_admin_delete_policy ON public.produtos
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 9. Table: public.questions
-- ============================================================================
DROP POLICY IF EXISTS questions_admin_modify_policy ON public.questions;

CREATE POLICY questions_admin_update_policy ON public.questions
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY questions_admin_delete_policy ON public.questions
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 10. Table: public.reviews
-- ============================================================================
DROP POLICY IF EXISTS reviews_admin_modify_policy ON public.reviews;

CREATE POLICY reviews_admin_update_policy ON public.reviews
FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);

CREATE POLICY reviews_admin_delete_policy ON public.reviews
FOR DELETE TO authenticated USING (public.is_admin());


-- ============================================================================
-- 11. Table: public.cart_items
-- ============================================================================
DROP POLICY IF EXISTS cart_items_modify_policy ON public.cart_items;

CREATE POLICY cart_items_insert_policy ON public.cart_items
FOR INSERT TO authenticated WITH CHECK (((SELECT auth.uid()) = user_id));

CREATE POLICY cart_items_update_policy ON public.cart_items
FOR UPDATE TO authenticated USING (
    ((SELECT auth.uid()) = user_id)
) WITH CHECK (((SELECT auth.uid()) = user_id));

CREATE POLICY cart_items_delete_policy ON public.cart_items
FOR DELETE TO authenticated USING (((SELECT auth.uid()) = user_id));

COMMIT;
