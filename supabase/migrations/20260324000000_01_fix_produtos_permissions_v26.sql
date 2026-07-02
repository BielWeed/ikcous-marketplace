-- 20260324_01_fix_produtos_permissions_v26.sql
-- Goal: Fix 403 Forbidden error on product updates by restoring necessary SELECT/DML grants for admins.
-- Context: 20260323_fix_produtos_custo_leak.sql revoked SELECT, which blocked UPDATE.

BEGIN;

-- 1. Restore basic DML permissions for the 'authenticated' role.
-- RLS filters will ensure only Admins (role = 'admin') can actually perform these actions.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;

-- 2. Restore basic SELECT for public usage if needed (though they should use the view)
-- Granting SELECT on current table to authenticated is safe because RLS is ACTIVE.
-- Non-admin authenticated users still see 0 rows due to 'Admins full access on products' policy.
-- This allows admins to update (which requires picking up the row first).

-- 3. Ensure permissions on the Public View (vw_produtos_public)
-- This view is used by the storefront to avoid exposing 'custo'.
GRANT SELECT ON public.vw_produtos_public TO anon, authenticated;

-- 4. Verify RLS is actually enabled (failsafe)
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

COMMIT;
