-- Synthetic fixture: only store_config from baseline plus known live additions. No business data.
BEGIN;
CREATE TABLE public.store_config (
    id bigint NOT NULL,
    free_shipping_min numeric(10,2) DEFAULT 100,
    shipping_fee numeric(10,2) DEFAULT 15,
    whatsapp_number "text" DEFAULT '5534999999999'::"text",
    share_text "text" DEFAULT 'Confira os produtos da Ikous!'::"text",
    business_hours "text" DEFAULT 'Seg-Sáb: 9h às 18h'::"text",
    enable_reviews boolean DEFAULT true,
    enable_coupons boolean DEFAULT true,
    primary_color "text" DEFAULT '#000000'::"text",
    theme_mode "text" DEFAULT 'light'::"text",
    logo_url "text",
    real_time_sales_alerts boolean DEFAULT true,
    push_marketing_enabled boolean DEFAULT false,
    min_app_version "text",
    created_at timestamp with time zone DEFAULT "now"(),
    updated_at timestamp with time zone DEFAULT "now"(),
    origin_cep "text" DEFAULT '38500-000'::"text",
    shipping_provider "text" DEFAULT 'flat_fee'::"text" NOT NULL,
    enabled_shipping_methods "text"[] DEFAULT '{sedex,pac}'::"text"[],
    shipping_coverage "text" DEFAULT 'national'::"text" NOT NULL,
    local_delivery_fee numeric DEFAULT 10.00 NOT NULL,
    local_cep_range "text",
    CONSTRAINT store_config_shipping_coverage_check CHECK (("shipping_coverage" = ANY (ARRAY['local'::"text", 'national'::"text"])))
);
ALTER TABLE public.store_config ADD PRIMARY KEY(id), ADD store_name text, ADD store_city text, ADD store_state text, ADD home_sections jsonb;
ALTER TABLE public.store_config ALTER origin_cep DROP DEFAULT, ALTER whatsapp_number DROP DEFAULT, ALTER business_hours DROP DEFAULT;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_role text;
BEGIN
  -- Se executado na sessão como postgres/service_role diretamente, autorizar
  IF current_setting('role', true) IN ('postgres', 'service_role') THEN
    RETURN true;
  END IF;

  -- 1º tentar ler dos claims do JWT (mais rápido)
  IF (current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) <> '') THEN
    v_role := (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role');
    IF v_role = 'admin' THEN
      RETURN true;
    END IF;
  END IF;

  -- 2º Fallback: consultar a tabela auth.users diretamente (sem RLS)
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = (SELECT auth.uid())
    AND (raw_app_meta_data ->> 'role') = 'admin'
  );
END;
$function$
;
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
    store_name, store_city, store_state, home_sections
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
    config_json->>'logo_url',
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
    config_json->'home_sections'
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
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.is_admin(), public.upsert_store_config(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.upsert_store_config(jsonb) TO authenticated,service_role;
ALTER TABLE public.store_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY store_config_admin_delete_policy ON public.store_config FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));
CREATE POLICY store_config_admin_insert_policy ON public.store_config FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));
CREATE POLICY store_config_admin_update_policy ON public.store_config FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));
CREATE POLICY store_config_select_policy ON public.store_config FOR SELECT USING (true);
CREATE VIEW public.v_store_config WITH (security_invoker=on) AS  SELECT id,
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
    home_sections
   FROM store_config
  WHERE (id = 1);
GRANT ALL ON public.store_config,public.v_store_config TO anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public,storage TO anon,authenticated,service_role;
GRANT ALL ON storage.objects TO anon,authenticated,service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, role text);
GRANT SELECT ON public.profiles TO anon,authenticated;
INSERT INTO auth.users(id,raw_app_meta_data) VALUES ('11111111-1111-4111-8111-111111111111','{"role":"admin"}'),('22222222-2222-4222-8222-222222222222','{"role":"customer"}');
INSERT INTO profiles VALUES ('11111111-1111-4111-8111-111111111111','admin'),('22222222-2222-4222-8222-222222222222','customer');
INSERT INTO store_config(id,store_name,primary_color,home_sections,logo_url) VALUES (1,'Loja ficticia','#000000','[{"id":"old-home"}]','https://legacy.example/logo.png'),(2,'Outra linha ficticia','#ABCDEF','[]',NULL);
INSERT INTO storage.buckets(id,name,public) VALUES ('products','products',true),('produtos','produtos',true),('banners','banners',true);
COMMIT;
