-- Identidade opcional da propria loja. Nenhuma linha existente e reescrita.
-- Reaplicacao e objetos ja presentes sao recusados, nunca sobrescritos.
-- A3/A5 devem conferir o project-ref: SQL valida a forma da URL, nao a infraestrutura.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.store_config IN ACCESS EXCLUSIVE MODE;
LOCK TABLE storage.buckets IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.store_config'::regclass
      AND attname IN ('secondary_color','accent_color','branding_assets') AND NOT attisdropped)
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('branding_a2_file_valid','branding_a2_assets_valid','branding_a2_logo_valid'))
    OR EXISTS (SELECT 1 FROM storage.buckets WHERE id='branding' OR name='branding')
    OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN ('branding_a2_public_select','branding_a2_admin_insert')) THEN
    RAISE EXCEPTION 'A2_ALREADY_PRESENT_OR_DIVERGENT: inspect existing identity objects before applying';
  END IF;
  IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
      WHERE oid=to_regprocedure('public.upsert_store_config(jsonb)'))
      IS DISTINCT FROM '2403a21fa4f3ee2c905df77b368868017bc512b0ec579452c6b8558513ecce31'
    OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
      WHERE oid=to_regprocedure('public.is_admin()'))
      IS DISTINCT FROM '9588d600d6b118b5bdd80f5f6fca5b6bea91b33b9eb502d3d37b5c09328f2fc1'
    OR encode(sha256(convert_to(pg_get_viewdef('public.v_store_config'::regclass,false),'UTF8')),'hex')
      IS DISTINCT FROM 'c5aec1aec658eb2cbcfb866ef02f5109dfff094ad78f1ab06c8cd22714bd2d21' THEN
    RAISE EXCEPTION 'A2_BASELINE_DIVERGENT: capture and review live definitions again';
  END IF;
  IF NOT COALESCE((SELECT 'security_invoker=on'=ANY(reloptions) FROM pg_class
      WHERE oid='public.v_store_config'::regclass),false) THEN
    RAISE EXCEPTION 'A2_BASELINE_DIVERGENT: view must remain security_invoker';
  END IF;
END $preflight$;

CREATE FUNCTION public.branding_a2_file_valid(asset jsonb, asset_role text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
DECLARE mime text; pathname text; dimension text;
BEGIN
  IF jsonb_typeof(asset) IS DISTINCT FROM 'object'
    OR NOT asset ?& ARRAY['path','sha256','media_type','bytes']
    OR asset - ARRAY['path','sha256','media_type','bytes','width','height'] <> '{}'::jsonb THEN RETURN false; END IF;
  IF jsonb_typeof(asset->'path') IS DISTINCT FROM 'string'
    OR jsonb_typeof(asset->'sha256') IS DISTINCT FROM 'string'
    OR jsonb_typeof(asset->'media_type') IS DISTINCT FROM 'string'
    OR jsonb_typeof(asset->'bytes') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  pathname := asset->>'path'; mime := asset->>'media_type';
  IF pathname !~ '^v1/[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
    OR asset->>'sha256' !~ '^[a-f0-9]{64}$'
    OR split_part(pathname,'/',2) <> asset->>'sha256'
    OR asset->>'bytes' !~ '^[0-9]+$' THEN RETURN false; END IF;
  IF (asset->>'bytes')::numeric NOT BETWEEN 1 AND 20971520 THEN RETURN false; END IF;
  IF NOT (CASE mime
    WHEN 'image/png' THEN lower(pathname) ~ '\.png$'
    WHEN 'image/jpeg' THEN lower(pathname) ~ '\.jpe?g$'
    WHEN 'image/webp' THEN lower(pathname) ~ '\.webp$'
    WHEN 'image/svg+xml' THEN lower(pathname) ~ '\.svg$'
    WHEN 'image/vnd.microsoft.icon' THEN lower(pathname) ~ '\.ico$'
    ELSE false END) THEN RETURN false; END IF;
  IF (asset ? 'width') <> (asset ? 'height') THEN RETURN false; END IF;
  IF asset ? 'width' THEN
    FOREACH dimension IN ARRAY ARRAY['width','height'] LOOP
      IF jsonb_typeof(asset->dimension) IS DISTINCT FROM 'number'
        OR asset->>dimension !~ '^[0-9]+$' THEN RETURN false; END IF;
      IF (asset->>dimension)::numeric NOT BETWEEN 1 AND 8192 THEN RETURN false; END IF;
    END LOOP;
  END IF;
  RETURN COALESCE(CASE asset_role
    WHEN 'original' THEN true
    WHEN 'header' THEN mime IN ('image/png','image/jpeg','image/webp','image/svg+xml')
    WHEN 'loader' THEN mime IN ('image/png','image/jpeg','image/webp','image/svg+xml')
    WHEN 'favicon' THEN mime IN ('image/png','image/svg+xml','image/vnd.microsoft.icon')
    WHEN 'apple_touch' THEN mime='image/png' AND asset->>'width'='180' AND asset->>'height'='180'
    WHEN 'icon_192' THEN mime='image/png' AND asset->>'width'='192' AND asset->>'height'='192'
    WHEN 'icon_512' THEN mime='image/png' AND asset->>'width'='512' AND asset->>'height'='512'
    WHEN 'maskable_512' THEN mime='image/png' AND asset->>'width'='512' AND asset->>'height'='512'
    WHEN 'og' THEN mime IN ('image/png','image/jpeg','image/webp') AND asset->>'width'='1200' AND asset->>'height'='630'
    ELSE false END,false);
END;
$function$;

CREATE FUNCTION public.branding_a2_assets_valid(assets jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
DECLARE asset jsonb; asset_role text;
  keys constant text[] := ARRAY['version','originals','header','loader','favicon','apple_touch','icon_192','icon_512','maskable_512','og'];
BEGIN
  IF assets IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(assets) IS DISTINCT FROM 'object'
    OR NOT assets ?& keys OR assets - keys <> '{}'::jsonb
    OR jsonb_typeof(assets->'version') IS DISTINCT FROM 'number'
    OR assets->>'version' IS DISTINCT FROM '1'
    OR jsonb_typeof(assets->'originals') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(assets->'originals') NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
  FOR asset IN SELECT value FROM jsonb_array_elements(assets->'originals') LOOP
    IF NOT public.branding_a2_file_valid(asset,'original') THEN RETURN false; END IF;
  END LOOP;
  FOREACH asset_role IN ARRAY ARRAY['header','loader','favicon','apple_touch','icon_192','icon_512','maskable_512','og'] LOOP
    IF NOT public.branding_a2_file_valid(assets->asset_role,asset_role) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$function$;

CREATE FUNCTION public.branding_a2_logo_valid(assets jsonb, logo text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT assets IS NULL OR COALESCE(
    logo ~ '^https://[a-z0-9]{20}\.supabase\.co/storage/v1/object/public/branding/'
    AND substring(logo FROM '^https://[a-z0-9]{20}\.supabase\.co/storage/v1/object/public/branding/(.*)$') = assets#>>'{header,path}', false);
$function$;

ALTER TABLE public.store_config
  ADD COLUMN secondary_color text,
  ADD COLUMN accent_color text,
  ADD COLUMN branding_assets jsonb,
  ADD CONSTRAINT store_config_secondary_color_a2_check CHECK (secondary_color IS NULL OR secondary_color ~ '^#[A-Fa-f0-9]{6}$'),
  ADD CONSTRAINT store_config_accent_color_a2_check CHECK (accent_color IS NULL OR accent_color ~ '^#[A-Fa-f0-9]{6}$'),
  ADD CONSTRAINT store_config_branding_assets_a2_check CHECK (public.branding_a2_assets_valid(branding_assets)),
  ADD CONSTRAINT store_config_branding_logo_a2_check CHECK (public.branding_a2_logo_valid(branding_assets,logo_url));

-- RPC e view abaixo partem dos corpos vivos revisados (09/09/2026).
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_methods text[];
  v_has_methods boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  -- Handle text[] casting safely
  v_has_methods := config_json ? 'enabled_shipping_methods'
    AND config_json->'enabled_shipping_methods' IS NOT NULL
    AND jsonb_typeof(config_json->'enabled_shipping_methods') = 'array';

  IF v_has_methods THEN
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
    shipping_coverage, local_delivery_fee, local_cep_range,
    store_name, store_city, store_state, home_sections,
    secondary_color, accent_color, branding_assets
  )
  VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 100),
    (config_json->>'shipping_fee')::numeric,
    -- 20261033000000: sem default de fábrica — ausência grava NULL e o
    -- botão de WhatsApp só nasce quando a lojista configurar o número.
    config_json->>'whatsapp_number',
    COALESCE(config_json->>'share_text', 'Confira os produtos!'),
    -- 20261033000000: sem default de fábrica — a vitrine só publica
    -- expediente que a lojista digitou (mesma regra da 20261029000000).
    config_json->>'business_hours',
    COALESCE((config_json->>'enable_reviews')::boolean, true),
    COALESCE((config_json->>'enable_coupons')::boolean, true),
    config_json->>'primary_color',  -- sentinela removida: ausente grava NULL
    COALESCE(config_json->>'theme_mode', 'light'),
    -- CHECK valida o candidato INSERT antes de ON CONFLICT. Reenvio de pacote
    -- com logo omitido usa a referencia atual somente neste candidato.
    CASE WHEN config_json ? 'logo_url' THEN config_json->>'logo_url'
      WHEN NULLIF(config_json->'branding_assets','null'::jsonb) IS NOT NULL
        THEN (SELECT logo_url FROM public.store_config WHERE id=1)
      ELSE NULL END,
    COALESCE((config_json->>'real_time_sales_alerts')::boolean, true),
    COALESCE((config_json->>'push_marketing_enabled')::boolean, false),
    config_json->>'min_app_version',
    config_json->>'origin_cep',
    COALESCE(config_json->>'shipping_provider', 'flat_fee'),
    v_methods,
    COALESCE(config_json->>'shipping_coverage', 'national'),
    COALESCE((config_json->>'local_delivery_fee')::numeric, 10.00),
    config_json->>'local_cep_range',
    config_json->>'store_name',
    config_json->>'store_city',
    config_json->>'store_state',
    config_json->'home_sections',
    config_json->>'secondary_color',
    config_json->>'accent_color',
    NULLIF(config_json->'branding_assets', 'null'::jsonb)
  )
  -- A partir daqui: só sobrescreve o que veio no payload. [ALTERADO]
  ON CONFLICT (id) DO UPDATE SET
    free_shipping_min = CASE WHEN config_json ? 'free_shipping_min'
      THEN (config_json->>'free_shipping_min')::numeric
      ELSE store_config.free_shipping_min END,
    shipping_fee = CASE WHEN config_json ? 'shipping_fee'
      THEN (config_json->>'shipping_fee')::numeric
      ELSE store_config.shipping_fee END,
    whatsapp_number = CASE WHEN config_json ? 'whatsapp_number'
      THEN config_json->>'whatsapp_number'
      ELSE store_config.whatsapp_number END,
    share_text = CASE WHEN config_json ? 'share_text'
      THEN config_json->>'share_text'
      ELSE store_config.share_text END,
    business_hours = CASE WHEN config_json ? 'business_hours'
      THEN config_json->>'business_hours'
      ELSE store_config.business_hours END,
    enable_reviews = CASE WHEN config_json ? 'enable_reviews'
      THEN (config_json->>'enable_reviews')::boolean
      ELSE store_config.enable_reviews END,
    enable_coupons = CASE WHEN config_json ? 'enable_coupons'
      THEN (config_json->>'enable_coupons')::boolean
      ELSE store_config.enable_coupons END,
    primary_color = CASE WHEN config_json ? 'primary_color'
      THEN config_json->>'primary_color'
      ELSE store_config.primary_color END,
    theme_mode = CASE WHEN config_json ? 'theme_mode'
      THEN config_json->>'theme_mode'
      ELSE store_config.theme_mode END,
    logo_url = CASE WHEN config_json ? 'logo_url'
      THEN config_json->>'logo_url'
      ELSE store_config.logo_url END,
    real_time_sales_alerts = CASE WHEN config_json ? 'real_time_sales_alerts'
      THEN (config_json->>'real_time_sales_alerts')::boolean
      ELSE store_config.real_time_sales_alerts END,
    push_marketing_enabled = CASE WHEN config_json ? 'push_marketing_enabled'
      THEN (config_json->>'push_marketing_enabled')::boolean
      ELSE store_config.push_marketing_enabled END,
    min_app_version = CASE WHEN config_json ? 'min_app_version'
      THEN config_json->>'min_app_version'
      ELSE store_config.min_app_version END,
    origin_cep = CASE WHEN config_json ? 'origin_cep'
      THEN config_json->>'origin_cep'
      ELSE store_config.origin_cep END,
    shipping_provider = CASE WHEN config_json ? 'shipping_provider'
      THEN config_json->>'shipping_provider'
      ELSE store_config.shipping_provider END,
    enabled_shipping_methods = CASE WHEN v_has_methods
      THEN v_methods
      ELSE store_config.enabled_shipping_methods END,
    shipping_coverage = CASE WHEN config_json ? 'shipping_coverage'
      THEN config_json->>'shipping_coverage'
      ELSE store_config.shipping_coverage END,
    local_delivery_fee = CASE WHEN config_json ? 'local_delivery_fee'
      THEN (config_json->>'local_delivery_fee')::numeric
      ELSE store_config.local_delivery_fee END,
    local_cep_range = CASE WHEN config_json ? 'local_cep_range'
      THEN config_json->>'local_cep_range'
      ELSE store_config.local_cep_range END,
    -- Tres colunas novas desta migration, mesmo padrao do PR #225 acima.
    store_name = CASE WHEN config_json ? 'store_name'
      THEN config_json->>'store_name'
      ELSE store_config.store_name END,
    store_city = CASE WHEN config_json ? 'store_city'
      THEN config_json->>'store_city'
      ELSE store_config.store_city END,
    store_state = CASE WHEN config_json ? 'store_state'
      THEN config_json->>'store_state'
      ELSE store_config.store_state END,
    -- home_sections: arranjo das vitrines da home. Grava só quando a chave
    -- vem no payload; preserva o que já estava lá quando não vem.
    home_sections = CASE WHEN config_json ? 'home_sections'
      THEN config_json->'home_sections'
      ELSE store_config.home_sections END,
    secondary_color = CASE WHEN config_json ? 'secondary_color'
      THEN config_json->>'secondary_color' ELSE store_config.secondary_color END,
    accent_color = CASE WHEN config_json ? 'accent_color'
      THEN config_json->>'accent_color' ELSE store_config.accent_color END,
    branding_assets = CASE WHEN config_json ? 'branding_assets'
      THEN NULLIF(config_json->'branding_assets','null'::jsonb) ELSE store_config.branding_assets END,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$function$
;

CREATE OR REPLACE VIEW public.v_store_config WITH (security_invoker=on) AS
 SELECT id,
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
    updated_at,
    store_name,
    store_city,
    store_state,
    home_sections,
    secondary_color,
    accent_color,
    branding_assets
   FROM store_config
  WHERE (id = 1);

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('branding','branding',true,20971520,
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml','image/vnd.microsoft.icon']);
CREATE POLICY branding_a2_public_select ON storage.objects FOR SELECT TO public
  USING (bucket_id='branding');
CREATE POLICY branding_a2_admin_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='branding' AND (SELECT public.is_admin()));

COMMIT;
