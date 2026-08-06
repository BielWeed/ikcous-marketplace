-- Migration: Optimize RLS Policies using wrapped is_admin() calls to resolve linter warnings
-- Date: 2026-07-08
-- Version: 20260708230000

BEGIN;

-- 1. Table: public.answers
DROP POLICY IF EXISTS answers_admin_delete_policy ON public.answers;
DROP POLICY IF EXISTS answers_admin_insert_policy ON public.answers;
DROP POLICY IF EXISTS answers_admin_update_policy ON public.answers;

CREATE POLICY answers_admin_insert_policy ON public.answers
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY answers_admin_update_policy ON public.answers
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY answers_admin_delete_policy ON public.answers
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));


-- 2. Table: public.banners
DROP POLICY IF EXISTS banners_admin_delete_policy ON public.banners;
DROP POLICY IF EXISTS banners_admin_insert_policy ON public.banners;
DROP POLICY IF EXISTS banners_admin_update_policy ON public.banners;
DROP POLICY IF EXISTS banners_select_policy ON public.banners;

CREATE POLICY banners_admin_insert_policy ON public.banners
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY banners_admin_update_policy ON public.banners
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY banners_admin_delete_policy ON public.banners
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY banners_select_policy ON public.banners
FOR SELECT TO public USING (
    (active = true)
    OR (((SELECT auth.role()) = 'authenticated') AND (SELECT public.is_admin()))
);


-- 3. Table: public.categorias
DROP POLICY IF EXISTS categorias_admin_delete_policy ON public.categorias;
DROP POLICY IF EXISTS categorias_admin_insert_policy ON public.categorias;
DROP POLICY IF EXISTS categorias_admin_update_policy ON public.categorias;

CREATE POLICY categorias_admin_insert_policy ON public.categorias
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY categorias_admin_update_policy ON public.categorias
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY categorias_admin_delete_policy ON public.categorias
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));


-- 4. Table: public.coupons
DROP POLICY IF EXISTS coupons_admin_delete_policy ON public.coupons;
DROP POLICY IF EXISTS coupons_admin_insert_policy ON public.coupons;
DROP POLICY IF EXISTS coupons_admin_update_policy ON public.coupons;
DROP POLICY IF EXISTS coupons_select_policy ON public.coupons;

CREATE POLICY coupons_admin_insert_policy ON public.coupons
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY coupons_admin_update_policy ON public.coupons
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY coupons_admin_delete_policy ON public.coupons
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY coupons_select_policy ON public.coupons
FOR SELECT TO public USING (
    (active = true)
    OR (((SELECT auth.role()) = 'authenticated') AND (SELECT public.is_admin()))
);


-- 5. Table: public.produtos
DROP POLICY IF EXISTS produtos_admin_delete_policy ON public.produtos;
DROP POLICY IF EXISTS produtos_admin_insert_policy ON public.produtos;
DROP POLICY IF EXISTS produtos_admin_update_policy ON public.produtos;
DROP POLICY IF EXISTS produtos_select_policy ON public.produtos;

CREATE POLICY produtos_admin_insert_policy ON public.produtos
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY produtos_admin_update_policy ON public.produtos
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY produtos_admin_delete_policy ON public.produtos
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY produtos_select_policy ON public.produtos
FOR SELECT TO public USING (
    (ativo = true)
    OR (((SELECT auth.role()) = 'authenticated') AND (SELECT public.is_admin()))
);


-- 6. Table: public.profiles
DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;

CREATE POLICY profiles_select_policy ON public.profiles
FOR SELECT TO authenticated USING (
    ((SELECT auth.uid()) = id) OR (SELECT public.is_admin())
);

CREATE POLICY profiles_update_policy ON public.profiles
FOR UPDATE TO authenticated USING (
    ((SELECT auth.uid()) = id) OR (SELECT public.is_admin())
) WITH CHECK (((SELECT auth.uid()) = id) OR (SELECT public.is_admin()));


-- 7. Table: public.store_shipping_credentials
DROP POLICY IF EXISTS "Admins have full access to shipping credentials" ON public.store_shipping_credentials;

CREATE POLICY "Admins have full access to shipping credentials" ON public.store_shipping_credentials
FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);


-- 8. Table: public.store_config
DROP POLICY IF EXISTS "Allow admin insert" ON public.store_config;
DROP POLICY IF EXISTS "Allow admin update" ON public.store_config;

CREATE POLICY "Allow admin insert" ON public.store_config
FOR INSERT TO public WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY "Allow admin update" ON public.store_config
FOR UPDATE TO public USING ((SELECT public.is_admin()));


-- 9. Table: public.marketplace_ai_state
DROP POLICY IF EXISTS marketplace_ai_state_admin_delete ON public.marketplace_ai_state;
DROP POLICY IF EXISTS marketplace_ai_state_admin_insert ON public.marketplace_ai_state;
DROP POLICY IF EXISTS marketplace_ai_state_admin_select ON public.marketplace_ai_state;
DROP POLICY IF EXISTS marketplace_ai_state_admin_update ON public.marketplace_ai_state;

CREATE POLICY marketplace_ai_state_admin_select ON public.marketplace_ai_state
FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY marketplace_ai_state_admin_insert ON public.marketplace_ai_state
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY marketplace_ai_state_admin_update ON public.marketplace_ai_state
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY marketplace_ai_state_admin_delete ON public.marketplace_ai_state
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));


-- 10. Table: public.cart_items
DROP POLICY IF EXISTS cart_items_select_policy ON public.cart_items;

CREATE POLICY cart_items_select_policy ON public.cart_items
FOR SELECT TO authenticated USING (
    ((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())
);


-- 11. Table: public.marketplace_order_history
DROP POLICY IF EXISTS order_history_all_policy ON public.marketplace_order_history;

CREATE POLICY order_history_all_policy ON public.marketplace_order_history
FOR ALL TO authenticated USING (
    (
        (SELECT public.is_admin())
        OR (EXISTS (
            SELECT 1 FROM public.marketplace_orders AS mo
            WHERE mo.id = order_id AND mo.user_id = (SELECT auth.uid())
        ))
    )
) WITH CHECK (((SELECT public.is_admin()) OR (EXISTS (
    SELECT 1 FROM public.marketplace_orders AS mo
    WHERE mo.id = order_id AND mo.user_id = (SELECT auth.uid())
))));


-- 12. Table: public._ninja_migrations
DROP POLICY IF EXISTS "Admins full access on _ninja_migrations" ON public._ninja_migrations;

CREATE POLICY "Admins full access on _ninja_migrations" ON public._ninja_migrations
FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);


-- 13. Table: public.shipping_quotes_cache
DROP POLICY IF EXISTS "Admins have full access to shipping_quotes_cache" ON public.shipping_quotes_cache;

CREATE POLICY "Admins have full access to shipping_quotes_cache" ON public.shipping_quotes_cache
FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);


-- 14. Table: public.reviews
DROP POLICY IF EXISTS reviews_admin_delete_policy ON public.reviews;
DROP POLICY IF EXISTS reviews_admin_update_policy ON public.reviews;

CREATE POLICY reviews_admin_update_policy ON public.reviews
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY reviews_admin_delete_policy ON public.reviews
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));


-- 15. Table: public.user_addresses
DROP POLICY IF EXISTS user_addresses_all_policy ON public.user_addresses;

CREATE POLICY user_addresses_all_policy ON public.user_addresses
FOR ALL TO authenticated USING (
    ((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())
) WITH CHECK (((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin()));


-- 16. Table: public.shipping_calculation_logs
DROP POLICY IF EXISTS "Admins have full access to shipping calculation logs" ON public.shipping_calculation_logs;

CREATE POLICY "Admins have full access to shipping calculation logs" ON public.shipping_calculation_logs
FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);


-- 17. Table: public.product_variants
DROP POLICY IF EXISTS product_variants_admin_delete_policy ON public.product_variants;
DROP POLICY IF EXISTS product_variants_admin_insert_policy ON public.product_variants;
DROP POLICY IF EXISTS product_variants_admin_update_policy ON public.product_variants;

CREATE POLICY product_variants_admin_insert_policy ON public.product_variants
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY product_variants_admin_update_policy ON public.product_variants
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY product_variants_admin_delete_policy ON public.product_variants
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));


-- 18. Table: public.analytics_events
DROP POLICY IF EXISTS analytics_events_select_policy ON public.analytics_events;

CREATE POLICY analytics_events_select_policy ON public.analytics_events
FOR SELECT TO authenticated USING ((SELECT public.is_admin()));


-- 19. Table: public.questions
DROP POLICY IF EXISTS questions_admin_delete_policy ON public.questions;
DROP POLICY IF EXISTS questions_admin_update_policy ON public.questions;

CREATE POLICY questions_admin_update_policy ON public.questions
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY questions_admin_delete_policy ON public.questions
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));


-- 20. Table: public.push_notifications_log
DROP POLICY IF EXISTS "SoloNinja Admin Full Access" ON public.push_notifications_log;

CREATE POLICY "SoloNinja Admin Full Access" ON public.push_notifications_log
FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);


-- 21. Table: public.push_subscriptions
DROP POLICY IF EXISTS push_subscriptions_all_policy ON public.push_subscriptions;

CREATE POLICY push_subscriptions_all_policy ON public.push_subscriptions
FOR ALL TO authenticated USING (
    ((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())
) WITH CHECK (((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin()));


-- 22. Table: public.vor_receipts
DROP POLICY IF EXISTS "Admins can view all VOR receipts" ON public.vor_receipts;
DROP POLICY IF EXISTS vor_receipts_insert_policy ON public.vor_receipts;

CREATE POLICY "Admins can view all VOR receipts" ON public.vor_receipts
FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY vor_receipts_insert_policy ON public.vor_receipts
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));


-- 23. Table: public.app_settings
DROP POLICY IF EXISTS "Admins legacy access on app_settings" ON public.app_settings;

CREATE POLICY "Admins legacy access on app_settings" ON public.app_settings
FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);


-- 24. Table: public.marketplace_orders
DROP POLICY IF EXISTS marketplace_orders_admin_delete_policy ON public.marketplace_orders;
DROP POLICY IF EXISTS marketplace_orders_admin_insert_policy ON public.marketplace_orders;
DROP POLICY IF EXISTS marketplace_orders_admin_update_policy ON public.marketplace_orders;
DROP POLICY IF EXISTS marketplace_orders_select_policy ON public.marketplace_orders;

CREATE POLICY marketplace_orders_admin_insert_policy ON public.marketplace_orders
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY marketplace_orders_admin_update_policy ON public.marketplace_orders
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY marketplace_orders_admin_delete_policy ON public.marketplace_orders
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

CREATE POLICY marketplace_orders_select_policy ON public.marketplace_orders
FOR SELECT TO authenticated USING (
    ((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin())
);


-- 25. Table: public.marketplace_order_items
DROP POLICY IF EXISTS order_items_all_policy ON public.marketplace_order_items;

CREATE POLICY order_items_all_policy ON public.marketplace_order_items
FOR ALL TO authenticated USING (
    (
        (SELECT public.is_admin())
        OR (EXISTS (
            SELECT 1 FROM public.marketplace_orders AS mo
            WHERE mo.id = order_id AND mo.user_id = (SELECT auth.uid())
        ))
    )
) WITH CHECK (((SELECT public.is_admin()) OR (EXISTS (
    SELECT 1 FROM public.marketplace_orders AS mo
    WHERE mo.id = order_id AND mo.user_id = (SELECT auth.uid())
))));


-- 26. Table: public.otp_verifications
DROP POLICY IF EXISTS "Admins full access on otp_verifications" ON public.otp_verifications;

CREATE POLICY "Admins full access on otp_verifications" ON public.otp_verifications
FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);


-- 27. Table: public.notificacoes
DROP POLICY IF EXISTS notificacoes_delete_policy ON public.notificacoes;
DROP POLICY IF EXISTS notificacoes_insert_policy ON public.notificacoes;
DROP POLICY IF EXISTS notificacoes_select_policy ON public.notificacoes;
DROP POLICY IF EXISTS notificacoes_update_policy ON public.notificacoes;

CREATE POLICY notificacoes_delete_policy ON public.notificacoes
FOR DELETE TO authenticated USING (
    ((SELECT auth.uid()) = usuario_id) OR (SELECT public.is_admin())
);

CREATE POLICY notificacoes_insert_policy ON public.notificacoes
FOR INSERT TO authenticated WITH CHECK (
    ((SELECT auth.uid()) = usuario_id) OR (SELECT public.is_admin())
);

CREATE POLICY notificacoes_select_policy ON public.notificacoes
FOR SELECT TO authenticated USING (
    ((SELECT auth.uid()) = usuario_id)
    OR (usuario_id IS null)
    OR (SELECT public.is_admin())
);

CREATE POLICY notificacoes_update_policy ON public.notificacoes
FOR UPDATE TO authenticated USING (
    ((SELECT auth.uid()) = usuario_id) OR (SELECT public.is_admin())
) WITH CHECK (((SELECT auth.uid()) = usuario_id) OR (SELECT public.is_admin()));

COMMIT;
