-- 20260423_sync_v_store_config_view.sql
-- Goal: Recreate v_store_config as a view pointing to store_config to keep public and admin settings automatically synchronized in real-time.

BEGIN;

-- 1. Drop existing table v_store_config if it exists
DROP VIEW IF EXISTS public.v_store_config CASCADE;
DROP TABLE IF EXISTS public.v_store_config CASCADE;

-- 2. Create the view with all non-sensitive configuration parameters
CREATE VIEW public.v_store_config AS
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
    real_time_sales_alerts,
    push_marketing_enabled,
    min_app_version,
    created_at,
    updated_at
FROM public.store_config
WHERE id = 1;

-- 3. Ensure appropriate permissions are granted to the anon, authenticated, and service_role database roles
ALTER VIEW public.v_store_config OWNER TO postgres;
GRANT SELECT ON public.v_store_config TO anon, authenticated, service_role;

COMMIT;
