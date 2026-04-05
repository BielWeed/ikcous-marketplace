-- 20260311_secure_store_config_refactor.sql
-- Solo-Ninja Security & Refactor Protocol
-- Objective: Fix credential leakage and clarify free shipping nomenclature.

BEGIN;

-- 1. Create Public View for Store Config (LEAK PROTECTION)
-- This view ONLY exposes safe columns to the public.
CREATE OR REPLACE VIEW public.vw_store_config_public AS
SELECT 
    id,
    free_shipping_min,
    shipping_fee,
    whatsapp_number,
    share_text,
    business_hours,
    enable_reviews,
    enable_coupons,
    primary_color,
    theme_mode,
    logo_url,
    min_app_version,
    updated_at
FROM public.store_config;

-- 2. Grant Permissions
GRANT SELECT ON public.vw_store_config_public TO anon, authenticated;

-- 3. Harden RLS on Base Table
-- Ensure sensitive columns (whatsapp_api_*) are ONLY accessible by admins.
ALTER TABLE public.store_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read safe config" ON public.store_config;
DROP POLICY IF EXISTS "Admins manage everything" ON public.store_config;

-- Policy for Admins: Full Access
CREATE POLICY "Admins manage everything" ON public.store_config
    FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Policy for Public: No direct access to base table for non-admins (force using the view)
-- Or, we can keep direct access but use a dynamic RLS that hides columns (more complex in Supabase)
-- Better approach: Revoke direct select from base table for anon, authenticated
-- and force them to use the view.
REVOKE SELECT ON public.store_config FROM anon, authenticated;
GRANT SELECT ON public.store_config TO authenticated; -- Admins are authenticated

-- Re-refining the policy for direct table access if scripts need it
DROP POLICY IF EXISTS "Admins read base table" ON public.store_config;
CREATE POLICY "Admins read base table" ON public.store_config
    FOR SELECT
    TO authenticated
    USING (public.is_admin());

COMMIT;
