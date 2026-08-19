-- Rollback manual de: 20260819000000_identidade_da_loja.sql
--
-- ATENÇÃO — LEIA ANTES DE RODAR:
--   O DROP COLUMN abaixo DESTRÓI a identidade (nome, cidade, estado) que a
--   lojista já tiver configurado pelo painel. Não há como recuperar esse valor
--   depois do DROP: o backup deste projeto é DIÁRIO e NÃO tem PITR (Point-in-
--   Time Recovery) — se a loja configurou a identidade e você roda este
--   rollback no mesmo dia, o único jeito de trazer o valor de volta é digitar
--   de novo no painel. Confirme que vale a pena perder o que foi configurado
--   antes de rodar.
--
-- ESCOPO: este arquivo desfaz a migration inteira — as três colunas novas, o
-- DEFAULT de origin_cep, e restaura upsert_store_config e v_store_config para
-- a definição de 20260806000000 (baseline), a última anterior a esta
-- migration. Diferente do rollback que o db-apply.cjs gera sozinho (que só
-- sabe restaurar função), este foi escrito à mão porque a migration também
-- mexe em ADD COLUMN e ALTER COLUMN, que o script não cobre.

-- 1. Restaura upsert_store_config para a definição do baseline (com os
--    COALESCE de origin_cep e shipping_fee que esta migration tirou, e sem
--    as três colunas novas).
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_store_config(jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.upsert_store_config(jsonb) TO authenticated, service_role;

-- 2. Restaura v_store_config para a definição do baseline (sem as três
--    colunas novas).
--
--    CREATE OR REPLACE VIEW não serve aqui: o Postgres só permite acrescentar
--    coluna ao FIM de uma view por CREATE OR REPLACE, nunca remover — tentar
--    encolher de 25 para 22 colunas morre com "cannot drop columns from view"
--    (42P16), e o passo seguinte (DROP COLUMN da tabela) morria em seguida
--    com "cannot drop column ... because other objects depend on it"
--    (2BP01), porque a view de 25 colunas continuava dependendo delas. Por
--    isso aqui é DROP + CREATE.
--
--    Sem CASCADE: nada mais no banco depende de v_store_config — conferido
--    via pg_depend/pg_rewrite antes de escrever este rollback (só aparecem o
--    tipo da própria view e a regra de reescrita dela, que o DROP já leva
--    junto). Se algo viesse a depender dela, CASCADE derrubaria esse algo
--    também, e isso seria pior do que o problema que este rollback resolve.
--
--    O DROP também leva o GRANT SELECT embora, então o GRANT logo abaixo
--    deixa de ser defensivo e passa a ser obrigatório.
DROP VIEW public.v_store_config;

CREATE VIEW public.v_store_config WITH (security_invoker='on') AS
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
    updated_at
   FROM public.store_config
  WHERE (id = 1);

GRANT SELECT ON public.v_store_config TO anon, authenticated, service_role;

-- 3. Tira as três colunas novas e devolve o DEFAULT de origin_cep.
--    IRREVERSÍVEL: qualquer valor que a loja tiver configurado em store_name,
--    store_city ou store_state se perde aqui — releia o aviso do topo antes
--    de rodar esta parte.
ALTER TABLE public.store_config
  DROP COLUMN IF EXISTS store_name,
  DROP COLUMN IF EXISTS store_city,
  DROP COLUMN IF EXISTS store_state;

ALTER TABLE public.store_config
  ALTER COLUMN origin_cep SET DEFAULT '38500-000'::text;
