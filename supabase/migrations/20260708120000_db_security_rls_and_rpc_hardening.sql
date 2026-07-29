-- Migration: Database Security Hardening and RLS Consolidation
-- Date: 2026-07-08
-- Version: 20260708120000

BEGIN;

-- ============================================================================
-- 1. CONSOLIDATE RLS POLICIES (Resolves multiple_permissive_policies)
-- ============================================================================

-- Table: public.analytics_events
DROP POLICY IF EXISTS analytics_events_insert_policy ON public.analytics_events;
DROP POLICY IF EXISTS "Public insert analytics" ON public.analytics_events;
DROP POLICY IF EXISTS "Admin read analytics" ON public.analytics_events;
DROP POLICY IF EXISTS admin_view_analytics ON public.analytics_events;
DROP POLICY IF EXISTS admin_select_analytics ON public.analytics_events;

CREATE POLICY analytics_events_insert_policy ON public.analytics_events
FOR INSERT TO public WITH CHECK (true);

CREATE POLICY analytics_events_select_policy ON public.analytics_events
FOR SELECT TO authenticated USING (public.is_admin());


-- Table: public.answers
DROP POLICY IF EXISTS answers_admin_all_policy ON public.answers;
DROP POLICY IF EXISTS answers_select_policy ON public.answers;
DROP POLICY IF EXISTS answers_all_policy ON public.answers;

CREATE POLICY answers_select_policy ON public.answers
FOR SELECT TO public USING (true);

CREATE POLICY answers_admin_modify_policy ON public.answers
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.banners
DROP POLICY IF EXISTS banners_admin_all_policy ON public.banners;
DROP POLICY IF EXISTS banners_select_policy ON public.banners;

CREATE POLICY banners_select_policy ON public.banners
FOR SELECT TO public USING (
    active = true
    OR ((SELECT auth.role()) = 'authenticated' AND public.is_admin())
);

CREATE POLICY banners_admin_modify_policy ON public.banners
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.cart_items
DROP POLICY IF EXISTS cart_items_all_policy ON public.cart_items;
DROP POLICY IF EXISTS "Admins can view all cart items" ON public.cart_items;

CREATE POLICY cart_items_select_policy ON public.cart_items
FOR SELECT TO authenticated USING (
    ((SELECT auth.uid()) = user_id) OR public.is_admin()
);

CREATE POLICY cart_items_modify_policy ON public.cart_items
FOR ALL TO authenticated USING (((SELECT auth.uid()) = user_id)) WITH CHECK (
    ((SELECT auth.uid()) = user_id)
);


-- Table: public.categorias
DROP POLICY IF EXISTS "Admins full access on categorias" ON public.categorias;
DROP POLICY IF EXISTS "Categorias are viewable by everyone" ON public.categorias;

CREATE POLICY categorias_select_policy ON public.categorias
FOR SELECT TO public USING (true);

CREATE POLICY categorias_admin_modify_policy ON public.categorias
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.coupons
DROP POLICY IF EXISTS coupons_admin_all_policy ON public.coupons;
DROP POLICY IF EXISTS coupons_select_policy ON public.coupons;

CREATE POLICY coupons_select_policy ON public.coupons
FOR SELECT TO public USING (
    active = true
    OR ((SELECT auth.role()) = 'authenticated' AND public.is_admin())
);

CREATE POLICY coupons_admin_modify_policy ON public.coupons
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.marketplace_ai_state
DROP POLICY IF EXISTS "Admins can manage AI state" ON public.marketplace_ai_state;
DROP POLICY IF EXISTS "Admins full access on marketplace_ai_state" ON public.marketplace_ai_state;

CREATE POLICY marketplace_ai_state_admin_policy ON public.marketplace_ai_state
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.marketplace_orders
DROP POLICY IF EXISTS marketplace_orders_admin_all_policy ON public.marketplace_orders;
DROP POLICY IF EXISTS marketplace_orders_select_policy ON public.marketplace_orders;
DROP POLICY IF EXISTS orders_all_policy ON public.marketplace_orders;

CREATE POLICY marketplace_orders_select_policy ON public.marketplace_orders
FOR SELECT TO authenticated USING (
    ((SELECT auth.uid()) = user_id) OR public.is_admin()
);

CREATE POLICY marketplace_orders_admin_modify_policy ON public.marketplace_orders
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.notificacoes
DROP POLICY IF EXISTS "Admins manage notifications" ON public.notificacoes;
DROP POLICY IF EXISTS notificacoes_delete_policy ON public.notificacoes;
DROP POLICY IF EXISTS "Admin/System insert notifications" ON public.notificacoes;
DROP POLICY IF EXISTS notificacoes_insert_policy ON public.notificacoes;
DROP POLICY IF EXISTS notificacoes_select_policy ON public.notificacoes;
DROP POLICY IF EXISTS notificacoes_update_policy ON public.notificacoes;

CREATE POLICY notificacoes_select_policy ON public.notificacoes
FOR SELECT TO authenticated USING (
    ((SELECT auth.uid()) = usuario_id)
    OR usuario_id IS null
    OR public.is_admin()
);

CREATE POLICY notificacoes_insert_policy ON public.notificacoes
FOR INSERT TO authenticated WITH CHECK (
    ((SELECT auth.uid()) = usuario_id) OR public.is_admin()
);

CREATE POLICY notificacoes_update_policy ON public.notificacoes
FOR UPDATE TO authenticated USING (
    ((SELECT auth.uid()) = usuario_id) OR public.is_admin()
) WITH CHECK (((SELECT auth.uid()) = usuario_id) OR public.is_admin());

CREATE POLICY notificacoes_delete_policy ON public.notificacoes
FOR DELETE TO authenticated USING (
    ((SELECT auth.uid()) = usuario_id) OR public.is_admin()
);


-- Table: public.product_variants
DROP POLICY IF EXISTS product_variants_admin_all_policy ON public.product_variants;
DROP POLICY IF EXISTS product_variants_select_policy ON public.product_variants;

CREATE POLICY product_variants_select_policy ON public.product_variants
FOR SELECT TO public USING (true);

CREATE POLICY product_variants_admin_modify_policy ON public.product_variants
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.produtos
DROP POLICY IF EXISTS produtos_admin_all_policy ON public.produtos;
DROP POLICY IF EXISTS produtos_select_policy ON public.produtos;

CREATE POLICY produtos_select_policy ON public.produtos
FOR SELECT TO public USING (
    ativo = true
    OR ((SELECT auth.role()) = 'authenticated' AND public.is_admin())
);

CREATE POLICY produtos_admin_modify_policy ON public.produtos
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.questions
DROP POLICY IF EXISTS questions_admin_all_policy ON public.questions;
DROP POLICY IF EXISTS questions_insert_policy ON public.questions;
DROP POLICY IF EXISTS questions_select_policy ON public.questions;
DROP POLICY IF EXISTS questions_update_policy ON public.questions;
DROP POLICY IF EXISTS questions_delete_policy ON public.questions;

CREATE POLICY questions_select_policy ON public.questions
FOR SELECT TO public USING (true);

CREATE POLICY questions_insert_policy ON public.questions
FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT null);

CREATE POLICY questions_admin_modify_policy ON public.questions
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- Table: public.reviews
DROP POLICY IF EXISTS reviews_admin_all_policy ON public.reviews;
DROP POLICY IF EXISTS reviews_insert_policy ON public.reviews;
DROP POLICY IF EXISTS reviews_select_policy ON public.reviews;
DROP POLICY IF EXISTS reviews_update_policy ON public.reviews;
DROP POLICY IF EXISTS reviews_delete_policy ON public.reviews;

CREATE POLICY reviews_select_policy ON public.reviews
FOR SELECT TO public USING (true);

CREATE POLICY reviews_insert_policy ON public.reviews
FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) IS NOT null);

CREATE POLICY reviews_admin_modify_policy ON public.reviews
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (
    public.is_admin()
);


-- ============================================================================
-- 2. HARDEN SECURITY DEFINER FUNCTIONS (Resolves anon_security_definer_function_executable)
-- ============================================================================

-- 1. admin-only and internal functions
-- Revoke from PUBLIC
REVOKE EXECUTE ON FUNCTION public.get_sales_analytics(
    timestamp without time zone, timestamp without time zone
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_customer_intelligence() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_retention_rate() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_coupon_stats() FROM public;
REVOKE EXECUTE ON FUNCTION public.swap_banner_order(uuid, uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_inventory_health() FROM public;
REVOKE EXECUTE ON FUNCTION public.upsert_store_config(jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_category_sales(text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_retention_analytics(integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_user_detail(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_executive_summary() FROM public;
REVOKE EXECUTE ON FUNCTION public.answer_question_atomic(
    uuid, text
) FROM public;
REVOKE EXECUTE ON FUNCTION public.answer_question_atomic(
    uuid, text, uuid
) FROM public;
REVOKE EXECUTE ON FUNCTION public.decrement_stock(uuid, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_stats() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_dashboard_summary() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_list_paginated(
    text, integer, integer, text, text
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_product_optimization_data() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_product_stats() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_retention_analytics() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_sales_analytics(
    timestamp with time zone, timestamp with time zone
) FROM public;
REVOKE EXECUTE ON FUNCTION public.reply_review_atomic(uuid, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.reply_review_atomic(
    uuid, text, uuid
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_v2() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_segmented_push_targets(
    text, numeric, integer
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_customers_paged(
    text, text, text, integer, integer
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_category_analytics(
    timestamp with time zone, timestamp with time zone
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_orders_paged(
    text, text, text, text, integer, integer
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_products_paged(
    text, text, text, text, integer, integer
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_reviews_paged(
    text, text, integer, integer
) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_order_status_atomic(
    uuid, text, text, boolean
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_admin_questions_paged(
    text, text, integer, integer
) FROM public;
REVOKE EXECUTE ON FUNCTION public.check_is_admin() FROM public;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public;

-- Grant execute to authenticated and service_role for admin-only functions
GRANT EXECUTE ON FUNCTION public.get_sales_analytics(
    timestamp without time zone, timestamp without time zone
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_intelligence() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_retention_rate() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_coupon_stats() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.swap_banner_order(uuid, uuid) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_health() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.upsert_store_config(jsonb) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_category_sales(
    text, text
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_retention_analytics(
    integer
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_user_detail(uuid) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_executive_summary() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.answer_question_atomic(
    uuid, text
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.answer_question_atomic(
    uuid, text, uuid
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.decrement_stock(
    uuid, integer
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_summary() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_list_paginated(
    text, integer, integer, text, text
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_product_optimization_data() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_product_stats() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_retention_analytics() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_analytics(
    timestamp with time zone, timestamp with time zone
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.reply_review_atomic(
    uuid, text
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.reply_review_atomic(
    uuid, text, uuid
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_v2() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_segmented_push_targets(
    text, numeric, integer
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_customers_paged(
    text, text, text, integer, integer
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_category_analytics(
    timestamp with time zone, timestamp with time zone
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_orders_paged(
    text, text, text, text, integer, integer
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_products_paged(
    text, text, text, text, integer, integer
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_reviews_paged(
    text, text, integer, integer
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.update_order_status_atomic(
    uuid, text, text, boolean
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_questions_paged(
    text, text, integer, integer
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;


-- 2. User-only functions (need authenticated session, but not admin)
REVOKE EXECUTE ON FUNCTION public.get_my_complete_profile() FROM public;
REVOKE EXECUTE ON FUNCTION public.sync_cart_atomic(jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.update_my_profile_secure(
    text, text, text, text
) FROM public;
REVOKE EXECUTE ON FUNCTION public.record_vor_action(
    text, jsonb, jsonb, text
) FROM public;

GRANT EXECUTE ON FUNCTION public.get_my_complete_profile() TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.sync_cart_atomic(jsonb) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.update_my_profile_secure(
    text, text, text, text
) TO authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.record_vor_action(
    text, jsonb, jsonb, text
) TO authenticated,
service_role;


-- 3. Guest-facing functions (must be callable by anon/guests)
REVOKE EXECUTE ON FUNCTION public.create_marketplace_order_v22(
    jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb
) FROM public;
REVOKE EXECUTE ON FUNCTION public.create_marketplace_order(
    jsonb, text, uuid, text, text, text, text
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_product_recommendations(
    uuid, integer
) FROM public;
REVOKE EXECUTE ON FUNCTION public.validate_coupon_secure_v2(
    text, numeric
) FROM public;
REVOKE EXECUTE ON FUNCTION public.validate_coupon_secure(
    text, numeric
) FROM public;
REVOKE EXECUTE ON FUNCTION public.check_user_confirmation_status(
    text
) FROM public;
REVOKE EXECUTE ON FUNCTION public.check_stock_v1(
    uuid, uuid, integer
) FROM public;
REVOKE EXECUTE ON FUNCTION public.generate_order_otp_v1(
    text, text, text
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_whatsapp(
    text, text
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v2(
    text, text, text
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(
    text, text, text
) FROM public;
REVOKE EXECUTE ON FUNCTION public.increment_helpful(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_reviews_metrics(
    text, integer
) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_products_with_variants() FROM public;

GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v22(
    jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb
) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.create_marketplace_order(
    jsonb, text, uuid, text, text, text, text
) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_product_recommendations(
    uuid, integer
) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.validate_coupon_secure_v2(
    text, numeric
) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.validate_coupon_secure(text, numeric) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.check_user_confirmation_status(text) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.check_stock_v1(uuid, uuid, integer) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.generate_order_otp_v1(
    text, text, text
) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp(text, text) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v2(
    text, text, text
) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(
    text, text, text
) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.increment_helpful(uuid) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_reviews_metrics(text, integer) TO anon,
authenticated,
service_role;
GRANT EXECUTE ON FUNCTION public.get_products_with_variants() TO anon,
authenticated,
service_role;

COMMIT;
