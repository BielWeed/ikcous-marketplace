-- Sentinela de "sem valor" da cor vira AUSENCIA de verdade.
--
-- Revisao 20260825-1305 (Claude) sobre o 498ccea: a sentinela #000000 morava
-- em DOIS lugares no BANCO, e consertar so no codigo deixava "ausente"
-- inatingivel — o postgrest-js omite a coluna do INSERT quando a chave falta,
-- o Postgres aplicava o DEFAULT da coluna, e o ramo de INSERT da RPC
-- completava com COALESCE(..., '#000000'). Resultado: loja recem-inicializada
-- nascia preta com a barra do celular na cor da marca, e nao havia tela para
-- desfazer.
--
-- O que esta migration faz, nesta ORDEM (as interrupcoes do meio importam --
-- ver revisao 20260825-1225-confirmo, condicao 1):
--   1. DROP DEFAULT da coluna primary_color — ausente = NULL. A fabrica de
--      preto morre PRIMEIRO: interromper depois daqui deixa estado seguro
--      (linhas velhas pretas esperando a limpeza, nada novo nasce preto).
--   2. Ramo de INSERT da upsert_store_config para de COALESCEar para
--      '#000000': chave ausente grava NULL.
--   3. RETRATO de quem era '#000000' antes da limpeza — o UPDATE do passo 4
--      nao tem volta por comando nenhum (o "rollback" ingenuo pintaria de
--      preto tambem as linhas que JA eram NULL). Nome FIXO amarrado a esta
--      migration: o rollback versionado sabe exatamente onde restaurar, em
--      qualquer banco de cliente, sem passo manual com memoria.
--   4. UPDATE: os '#000000' materializados viram NULL. Seguro HOJE porque
--      nenhuma tela nem edge function escreve primary_color (varredura
--      20260825-1305: so a RPC, escrevendo o que o chamador manda, e o
--      unico chamador do repo e um teste). Assinatura honesta: isto e
--      REVERSIVEL SE ESTIVER ERRADO (retrato), nao e "seguro" — ninguem
--      prova que ninguem gravou #000000 a mao no editor SQL.
-- Compativel nos dois sentidos (expand/contract): codigo anterior manda cor
-- explicita e nao encosta no default; codigo atual omite e recebe NULL, que
-- e o que ele espera. Codigo posterior ao rollback idem. O retrato e expand;
-- derrubar a tabela do retrato e o contract de um lote POSTERIOR.
--
-- SEM BEGIN/COMMIT (regra da casa: com eles o ROLLBACK da prova vira no-op).
-- Faixa 20260980* a 20260989*, reservada no _REGRAS.md ANTES de existir.
-- NAO aplicar sem prova de ROLLBACK (inteira E interrompida no meio) e sem
-- o Gabriel autorizar NESTA sessao.

ALTER TABLE public.store_config ALTER COLUMN primary_color DROP DEFAULT;

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
    COALESCE(config_json->>'business_hours', 'Seg-Sáb: 9h às 18h'),
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

-- Passo 3: RETRATO (antes da limpeza — sem ele o rollback do passo 4
-- destruiria a informacao que o NULL passou a representar).
CREATE TABLE IF NOT EXISTS public._retrato_primary_color_20260980 AS
  SELECT id, primary_color FROM public.store_config
  WHERE primary_color = '#000000';

-- Passo 4: limpeza. Os pretos de fabrica materializados voltam ao estado
-- "a loja nunca escolheu" (NULL = semente do build no runtime).
UPDATE public.store_config
   SET primary_color = NULL
 WHERE primary_color = '#000000';
