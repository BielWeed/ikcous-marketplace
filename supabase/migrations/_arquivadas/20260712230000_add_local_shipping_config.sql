-- 20260712230000_add_local_shipping_config.sql
-- Goal: Add shipping coverage and local delivery settings to store_config, and update view and upsert function.

BEGIN;

-- 1. Add logistics columns to public.store_config table
ALTER TABLE public.store_config
ADD COLUMN IF NOT EXISTS shipping_coverage text DEFAULT 'national' NOT NULL,
ADD COLUMN IF NOT EXISTS local_delivery_fee numeric DEFAULT 10.00 NOT NULL,
ADD COLUMN IF NOT EXISTS local_cep_range text DEFAULT null;

-- Add check constraint for shipping_coverage
ALTER TABLE public.store_config
DROP CONSTRAINT IF EXISTS store_config_shipping_coverage_check,
ADD CONSTRAINT store_config_shipping_coverage_check CHECK (shipping_coverage IN ('local', 'national'));

-- 2. Drop and recreate public.v_store_config view to include new columns
DROP VIEW IF EXISTS public.v_store_config CASCADE;

CREATE VIEW public.v_store_config WITH (security_invoker = on) AS
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
    origin_cep,
    shipping_provider,
    enabled_shipping_methods,
    shipping_coverage,
    local_delivery_fee,
    local_cep_range,
    created_at,
    updated_at
FROM public.store_config
WHERE id = 1;

-- 3. Re-grant permissions for the view
GRANT SELECT ON public.v_store_config TO anon, authenticated, service_role;

-- 4. Recreate upsert_store_config function supporting new logistics columns
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  v_methods text[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  -- Handle text[] casting safely
  IF config_json ? 'enabled_shipping_methods' AND config_json->'enabled_shipping_methods' IS NOT NULL AND jsonb_typeof(config_json->'enabled_shipping_methods') = 'array' THEN
    SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_methods 
    FROM jsonb_array_elements_text(config_json->'enabled_shipping_methods') x;
  ELSE
    v_methods := '{sedex, pac}'::text[];
  END IF;

  INSERT INTO public.store_config (
    id, free_shipping_min, shipping_fee, whatsapp_number, share_text, 
    business_hours, enable_reviews, enable_coupons, primary_color, 
    theme_mode, logo_url, real_time_sales_alerts, push_marketing_enabled, 
    min_app_version, origin_cep, shipping_provider, enabled_shipping_methods,
    shipping_coverage, local_delivery_fee, local_cep_range
  )
  VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 100),
    COALESCE((config_json->>'shipping_fee')::numeric, 15),
    COALESCE(config_json->>'whatsapp_number', '5534999999999'),
    COALESCE(config_json->>'share_text', 'Confira os produtos!'),
    COALESCE(config_json->>'business_hours', 'Seg-Sáb: 9h às 18h'),
    COALESCE((config_json->>'enable_reviews')::boolean, true),
    COALESCE((config_json->>'enable_coupons')::boolean, true),
    COALESCE(config_json->>'primary_color', '#000000'),
    COALESCE(config_json->>'theme_mode', 'light'),
    config_json->>'logo_url',
    COALESCE((config_json->>'real_time_sales_alerts')::boolean, true),
    COALESCE((config_json->>'push_marketing_enabled')::boolean, false),
    config_json->>'min_app_version',
    COALESCE(config_json->>'origin_cep', '38500-000'),
    COALESCE(config_json->>'shipping_provider', 'flat_fee'),
    v_methods,
    COALESCE(config_json->>'shipping_coverage', 'national'),
    COALESCE((config_json->>'local_delivery_fee')::numeric, 10.00),
    config_json->>'local_cep_range'
  )
  ON CONFLICT (id) DO UPDATE SET
    free_shipping_min = EXCLUDED.free_shipping_min,
    shipping_fee = EXCLUDED.shipping_fee,
    whatsapp_number = EXCLUDED.whatsapp_number,
    share_text = EXCLUDED.share_text,
    business_hours = EXCLUDED.business_hours,
    enable_reviews = EXCLUDED.enable_reviews,
    enable_coupons = EXCLUDED.enable_coupons,
    primary_color = EXCLUDED.primary_color,
    theme_mode = EXCLUDED.theme_mode,
    logo_url = EXCLUDED.logo_url,
    real_time_sales_alerts = EXCLUDED.real_time_sales_alerts,
    push_marketing_enabled = EXCLUDED.push_marketing_enabled,
    min_app_version = EXCLUDED.min_app_version,
    origin_cep = EXCLUDED.origin_cep,
    shipping_provider = EXCLUDED.shipping_provider,
    enabled_shipping_methods = EXCLUDED.enabled_shipping_methods,
    shipping_coverage = EXCLUDED.shipping_coverage,
    local_delivery_fee = EXCLUDED.local_delivery_fee,
    local_cep_range = EXCLUDED.local_cep_range,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

COMMIT;
