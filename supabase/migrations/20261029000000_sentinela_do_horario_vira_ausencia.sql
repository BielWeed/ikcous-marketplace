-- A sentinela de "sem valor" do HORÁRIO vira AUSENCIA de verdade.
--
-- Follow-up OBRIGATÓRIO da revisão do PR #349 (item 6 do laudo de 29/08):
-- o horário passou a ser exibido na vitrine, e o DEFAULT DE FÁBRICA da
-- coluna ('Seg-Sáb: 9h às 18h', baseline :4224) + o COALESCE da
-- upsert_store_config + o seed do runtime publicavam esse expediente
-- INVENTADO para loja que nunca o configurou — o cliente não distingue
-- default de fábrica de texto digitado. Mesma classe de mentira que a
-- casa já matou para a cor (20260980000000_sentinela_de_cor_vira_ausencia,
-- o MOLDE desta migration: mesmos 4 passos, mesma ordem, mesmos motivos).
--
-- O que esta migration faz, nesta ORDEM:
--   1. DROP DEFAULT da coluna business_hours — ausente = NULL. A fábrica
--      morre PRIMEIRO: interromper depois daqui deixa estado seguro
--      (linhas velhas com a sentinela esperando a limpeza, nada novo
--      nasce com horário inventado).
--   2. Ramo de INSERT da upsert_store_config para de COALESCEar para o
--      literal: chave ausente grava NULL. (O ramo de UPDATE já usa CASE
--      por PRESENÇA de chave — sem sentinela, não mexe.)
--   3. RETRATO de quem tinha o literal de fábrica antes da limpeza — o
--      UPDATE do passo 4 não tem volta por comando nenhum. Tabela nomeada
--      amarrada a esta migration, RLS sem policy (mesma decisão do molde).
--   4. UPDATE: o literal de fábrica materializado vira NULL = "a loja
--      nunca disse". Loja que DIGITOU outro horário não é tocada.
--
-- SEM BEGIN/COMMIT (regra da casa). NÃO aplicar sem prova de ROLLBACK e
-- sem o Gabriel autorizar NESTA sessão.
--
-- FICHA DE VERIFICAÇÃO pos-aplicação, POR BANCO (molde: 20260980000000):
--
--   ANTES de aplicar, rodar e ANOTAR:
--     SELECT count(*) FROM public.store_config
--      WHERE business_hours = 'Seg-Sáb: 9h às 18h';
--
--   passo 1 (DROP DEFAULT):
--     SELECT column_default FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='store_config'
--        AND column_name='business_hours';
--     -> espera NULL
--   passo 2 (RPC sem COALESCE do horário):
--     SELECT (pg_get_functiondef('public.upsert_store_config(jsonb)'::regprocedure)
--       LIKE '%COALESCE(config_json->>''business_hours''%') AS ainda_coalesceia;
--     -> espera false
--   passo 3 (retrato):
--     SELECT count(*) FROM public._retrato_business_hours_20261029;
--     -> espera exatamente o número ANOTADO no ANTES
--   passo 4 (limpeza):
--     SELECT count(*) FROM public.store_config
--      WHERE business_hours = 'Seg-Sáb: 9h às 18h';
--     -> espera 0
--   passo 5 (a vitrine lê NULL e o bloco do horário NÃO aparece):
--     abrir a loja sem configurar horário e conferir.

-- ============================================================
-- Passo 1
-- ============================================================

ALTER TABLE public.store_config ALTER COLUMN business_hours DROP DEFAULT;

-- ============================================================
-- Passo 2
-- ============================================================
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
    COALESCE(config_json->>'whatsapp_number', '5534999999999'),
    COALESCE(config_json->>'share_text', 'Confira os produtos!'),
    config_json->>'business_hours',  -- sentinela removida: ausente grava NULL
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
$function$;

-- ============================================================
-- Passo 3: RETRATO (antes da limpeza).
-- ============================================================

CREATE TABLE IF NOT EXISTS public._retrato_business_hours_20261029 AS
  SELECT id, business_hours FROM public.store_config
  WHERE business_hours = 'Seg-Sáb: 9h às 18h';

-- RLS sem policy: artefato de rollback não é leitura de app (decisão do
-- molde 20260980000000 — sem esta linha o advisor marca
-- rls_disabled_in_public como ERROR em toda loja clonada).
ALTER TABLE public._retrato_business_hours_20261029
  ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Passo 4: limpeza. O horário de fábrica materializado volta ao estado
-- "a loja nunca disse" (NULL = bloco do horário não aparece na vitrine).
-- ============================================================

UPDATE public.store_config
   SET business_hours = NULL
 WHERE business_hours = 'Seg-Sáb: 9h às 18h';
