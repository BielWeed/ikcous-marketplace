-- Migration: Harden and clean up remaining RLS policies
-- Date: 2026-07-09
-- Version: 20260709002000

BEGIN;

-- 1. Table: public.product_variants
DROP POLICY IF EXISTS "Admins full access on variants" ON public.product_variants;


-- 2. Table: public.push_notifications_log
DROP POLICY IF EXISTS "Admins manage push logs" ON public.push_notifications_log;
DROP POLICY IF EXISTS "SoloNinja Admin Full Access" ON public.push_notifications_log;

CREATE POLICY push_notifications_log_admin_all_policy ON public.push_notifications_log
FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);


-- 3. Table: public.store_config
DROP POLICY IF EXISTS "Admins manage everything" ON public.store_config;
DROP POLICY IF EXISTS "Allow admin insert" ON public.store_config;
DROP POLICY IF EXISTS "Allow admin update" ON public.store_config;
DROP POLICY IF EXISTS "Public can view store config" ON public.store_config;

CREATE POLICY store_config_select_policy ON public.store_config
FOR SELECT TO public USING (true);

CREATE POLICY store_config_admin_insert_policy ON public.store_config
FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY store_config_admin_update_policy ON public.store_config
FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK (
    (SELECT public.is_admin())
);

CREATE POLICY store_config_admin_delete_policy ON public.store_config
FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- Insert migration record
INSERT INTO public._ninja_migrations (filename, applied_at) VALUES (
    '20260709002000_harden_remaining_rls_policies.sql', now()
);

COMMIT;
