-- A PÁGINA "SOBRE A LOJA" GANHA ENDEREÇO E DESCRIÇÃO EDITÁVEIS PELO LOJISTA
-- (pedido do dono 20/09/2026; fila serializada — uma por vez)
--
-- O QUE FALTAVA: a página pública "Sobre a Loja" (AboutStoreView) lê a
-- identidade da loja da store_config, mas o mapa se alimenta do CEP DE
-- FRETE (origin_cep, tela de Frete — aproximação sem dono) e o bloco de
-- descrição vive oculto esperando a coluna (comentário da view desde a
-- 20261033000000: "coluna nova, decisão do dono"). O dono decidiu: a loja
-- declara o ENDEREÇO que aparece no mapa e a DESCRIÇÃO que conta a marca.
--
-- AS DUAS COLUNAS NOVAS:
--   - store_address text NULL — endereço de texto livre (ex.: "Avenida
--     Paulista, 1578 — Bela Vista"). NULL = a loja não disse; a página
--     pública cai para CEP de frete / cidade-UF como hoje. Sem DEFAULT:
--     texto da loja não tem valor de fábrica (régua da 20261033000000).
--   - store_description text NULL — o admin grava HTML SIMPLES (parágrafos
--     gerados do texto digitado, com escape de &<>) e a página pública
--     SEMPRE sanitiza com DOMPurify no render (defesa independente, já
--     viva no front). NULL = bloco não existe na página (régua da casa).
--
-- POR QUE a entrada na upsert_store_config segue o padrão das store_* de
-- texto: INSERT sem COALESCE (ausência grava NULL, nunca inventa) e
-- ON CONFLICT com CASE WHEN config_json ? 'coluna' — só sobrescreve o que
-- veio no payload. É esse CASE que garante o aceite do dono: salvar o
-- ENDEREÇO não apaga a DESCRIÇÃO, o horário, o nome nem nada mais.
--
-- SEGURANÇA/EXPOSIÇÃO: endereço e descrição são PÚBLICOS por natureza
-- (exibidos em /about-store) — herdam o que já existe: RLS da tabela
-- (SELECT público, escrita só via RPC com is_admin()) e a
-- v_store_config (security_invoker) pela qual o cliente lê. NÃO entram no
-- WHEN das triggers dominio_publico_* (são do lojista, não da frota) e
-- NÃO entram na save_store_identity (identidade revisada intocada).
--
-- DADOS EXISTENTES: a linha id=1 ganha NULL/NULL (ADD COLUMN sem DEFAULT).
-- Nenhuma linha é lida, comparada nem reescrita por esta migration.
--
-- IDEMPOTÊNCIA: ADD COLUMN IF NOT EXISTS ×2, CREATE OR REPLACE VIEW e
-- CREATE OR REPLACE FUNCTION deixam o mesmo estado se reaplicadas. A view
-- lista as 34 colunas que a 20261150 deixou NA MESMA ORDEM + as 2 novas no
-- FIM (OR REPLACE só aceita coluna nova no fim).
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- `node scripts/db-apply.cjs` (uma transação por arquivo). Sem
-- BEGIN/COMMIT de nível superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (prova completa em transação com
-- ROLLBACK em scripts/db-prove-sobre-a-loja.cjs):
--   1. SELECT column_name FROM information_schema.columns
--      WHERE table_name='store_config'
--        AND column_name IN ('store_address','store_description');
--      -- esperado: 2 linhas.
--   2. SELECT store_address, store_description FROM public.v_store_config;
--      -- esperado: 1 linha, NULL/NULL antes do lojista preencher.

-- Preflight no molde da 20261165000000: a upsert_store_config é
-- SECURITY DEFINER e é a porta de configuração da loja — substituir por um
-- corpo que não seja o vivo revisado é exatamente o risco que o hash abaixo
-- fecha. O hash é do CORPO QUE A 20261165000000 DEIXOU (o miolo entre os
-- dollar-quotes dela, em LF como o workflow Linux aplica; o teste desta
-- migration recalcula o hash do arquivo-fonte, para o hash nunca descolar
-- dele).
DO $preflight$
DECLARE v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO v_hash
    FROM pg_proc WHERE oid=to_regprocedure('public.upsert_store_config(jsonb)');
  IF v_hash IS DISTINCT FROM '4dcf11600a05bb275a478eec0314c502802f3243ae6fb85816785a1461eaef7d' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo da upsert_store_config difere do esperado (hash %) — capture e revise antes de aplicar', v_hash;
  END IF;
END $preflight$;

ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_address text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_description text;

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
    branding_assets,
    dominio_publico,
    mp_public_key,
    vapid_public_key,
    pagamento_online,
    manutencao,
    store_address,
    store_description
   FROM store_config
  WHERE id = 1;

-- Corpo: o vivo da 20261165000000 com as ÚNICAS trocas comentadas abaixo —
-- nenhuma outra linha mudou (o preflight acima garantiu o ponto de partida).
--   (a) lista de colunas do INSERT: + store_address, store_description
--   (b) VALUES do INSERT: sem COALESCE — ausência grava NULL, nunca inventa
--       (mesma régua de whatsapp_number/business_hours da 20261033000000)
--   (c) ON CONFLICT: só sobrescreve a coluna que veio no payload
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
    secondary_color, accent_color, branding_assets,
    store_address, store_description
  )
  VALUES (
    1,
    COALESCE((config_json->>'free_shipping_min')::numeric, 0),
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
    NULLIF(config_json->'branding_assets', 'null'::jsonb),
    -- 20261167000000: sem default de fábrica — endereço e descrição só
    -- existem quando a lojista digita (mesma régua das store_* de texto).
    config_json->>'store_address',
    config_json->>'store_description'
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
    -- 20261167000000: endereço e descrição — o CASE é o coração do aceite
    -- "salvar um campo não apaga os outros".
    store_address = CASE WHEN config_json ? 'store_address'
      THEN config_json->>'store_address'
      ELSE store_config.store_address END,
    store_description = CASE WHEN config_json ? 'store_description'
      THEN config_json->>'store_description'
      ELSE store_config.store_description END,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$function$;
