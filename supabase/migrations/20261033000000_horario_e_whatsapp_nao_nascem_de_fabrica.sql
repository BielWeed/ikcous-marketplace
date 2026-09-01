-- Defaults de fábrica deixam de nascer em loja nova (laudo caça-bugs Savy,
-- 30/08/2026; decisão do Gabriel ~20:05: WhatsApp e horário são configuração
-- da lojista no painel).
--
-- CAUSA RAIZ PROVADA: o ramo INSERT da `upsert_store_config` usava COALESCE
-- com valor de fábrica para `whatsapp_number` ('5534999999999') e
-- `business_hours` ('Seg-Sáb: 9h às 18h'). A primeira gravação de config de
-- uma loja nova passa por esse INSERT e nasce com dados que ninguém digitou.
-- Medido na cliente-01 (Savy): `store_config` criada 30/08 06:18Z já com
-- 'Seg-Sáb: 9h às 18h' — a vitrine publicava um expediente inventado desde o
-- primeiro minuto. A migration 20261029000000 limpou o dado existente e o
-- default da COLUNA, mas o default dentro da RPC continuou plantando.
--
-- O que muda aqui:
--   1. Ramo INSERT: as duas colunas passam a gravar o que veio no payload,
--      SEM COALESCE de fábrica — ausência grava NULL ("a loja não disse"),
--      mesmo contrato da sentinela de cor (20260980000000) e do horário
--      (20261029000000). O ramo UPDATE já era limpo (CASE WHEN ? chave) e
--      NÃO muda.
--   2. Limpeza das sentinelas já gravadas (mesma classificação da
--      20261029000000 — valores de fábrica, jamais digitados por lojista):
--      business_hours 'Seg-Sáb: 9h às 18h' -> NULL;
--      whatsapp_number '34999999999' e '5534999999999' -> NULL.
--      Consumidores de `whatsapp_number` já tratam NULL (`|| ""` em
--      ProductView.tsx:696 e CheckoutView.tsx:2526; botão some quando vazio).
--
-- `CREATE OR REPLACE FUNCTION` preserva GRANT/dono (licao 448 do _REGRAS);
-- assinatura repetida idêntica para não criar sobrecarga silenciosa.
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op).
--
-- FICHA DE VERIFICAÇÃO pos-aplicação (rodar contra o banco):
--   -- 1. INSERT sem as chaves NÃO planta mais fábrica (em transação com
--   --    ROLLBACK, ou conferindo depois de um DELETE cuidadoso — sugerido:
--   --    prova em transação):
--   BEGIN;
--     DELETE FROM store_config;  -- prova em transação, ROLLBACK no fim
--     SELECT upsert_store_config('{"shipping_fee": 15}'::jsonb);
--     SELECT business_hours, whatsapp_number FROM store_config;
--     -> espera NULL | NULL (antes: 'Seg-Sáb: 9h às 18h' | '5534999999999')
--   ROLLBACK;
--   -- 2. UPDATE continua preservando campo ausente:
--   BEGIN;
--     SELECT upsert_store_config('{"shipping_fee": 99}'::jsonb);
--     SELECT shipping_fee, coalesce(business_hours,'(null)') FROM store_config;
--     -> espera shipping_fee = 99 e business_hours inalterado
--   ROLLBACK;
--   -- 3. Sentinelas limpas:
--   SELECT count(*) FROM store_config
--     WHERE business_hours = 'Seg-Sáb: 9h às 18h'
--        OR whatsapp_number IN ('34999999999','5534999999999');
--   -> espera 0
--
-- ROLLBACK MANUAL: versionado em
-- rollback-manual-20261033000000_horario_e_whatsapp_nao_nascem_de_fabrica.sql

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
$function$;

-- Limpeza das sentinelas já gravadas (valores de fábrica, nunca digitados
-- por lojista — mesma classificação da 20261029000000). Idempotentes.
UPDATE public.store_config
   SET business_hours = NULL
 WHERE business_hours = 'Seg-Sáb: 9h às 18h';

UPDATE public.store_config
   SET whatsapp_number = NULL
 WHERE whatsapp_number IN ('34999999999', '5534999999999');
