-- 20260708080000_add_shipping_api_config.sql
-- Goal: Add shipping API configuration tables, extend store_config, and recreate the v_store_config view.

BEGIN;

-- 1. Create store_shipping_credentials table for sensitive API tokens
CREATE TABLE IF NOT EXISTS public.store_shipping_credentials (
    provider text PRIMARY KEY,
    credentials jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone(
        'utc'::text, now()
    ) NOT NULL
);

-- Enable RLS
ALTER TABLE public.store_shipping_credentials ENABLE ROW LEVEL SECURITY;

-- Create administrative policy for RLS
CREATE POLICY "Admins have full access to shipping credentials"
ON public.store_shipping_credentials
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
);

-- 2. Add logistics columns to public.store_config table
ALTER TABLE public.store_config
ADD COLUMN IF NOT EXISTS origin_cep text DEFAULT '38500-000',
ADD COLUMN IF NOT EXISTS shipping_provider text DEFAULT 'flat_fee' NOT NULL,
ADD COLUMN IF NOT EXISTS enabled_shipping_methods text [] DEFAULT '{sedex, pac}'::text [];

-- 3. Drop existing view v_store_config
DROP VIEW IF EXISTS public.v_store_config CASCADE;

-- 4. Recreate v_store_config view including new logistics columns
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
    origin_cep,
    shipping_provider,
    enabled_shipping_methods,
    created_at,
    updated_at
FROM public.store_config
WHERE id = 1;

-- 5. Recreate upsert_store_config function supporting new logistics columns
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
    min_app_version, origin_cep, shipping_provider, enabled_shipping_methods
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
    v_methods
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
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

-- 6. Ensure appropriate permissions are granted to the anon, authenticated, and service_role database roles
ALTER VIEW public.v_store_config OWNER TO postgres;
GRANT SELECT ON public.v_store_config TO anon, authenticated, service_role;

COMMIT;
