-- O FRETE NACIONAL GANHA ESTRATÉGIA PRÓPRIA (estratégias de frete local e
-- nacional, T1/banco, 23/09/2026)
--
-- Plano: docs/superpowers/plans/2026-09-23-estrategias-de-frete-local-e-nacional.md
-- (CONTRATO FIXO). Desenho: docs/superpowers/specs/2026-09-23-estrategias-de-frete-local-e-nacional-design.md.
--
-- O QUE FALTAVA: `store_config.free_shipping_min` é hoje o ÚNICO campo de
-- frete grátis, e ele decide para QUALQUER modalidade de entrega — inclusive
-- transportadora (bloco 4 de create_marketplace_order_v23/_v24, antes desta
-- migration). O dono pediu duas coisas separadas: "estratégias do frete
-- LOCAL" (o campo que já existe, sem mudar) e uma tela própria de
-- "estratégias do frete NACIONAL" (grátis acima de um valor, ou desconto
-- percentual/fixo na opção nacional mais barata) — a promoção local nunca
-- mais vaza para o nacional.
--
-- AS 5 COLUNAS NOVAS em store_config (CHECK — é dinheiro):
--   national_shipping_strategy text NOT NULL DEFAULT 'desligado'
--     IN ('desligado','acima_de_valor','sempre','por_produto','desconto_na_mais_barata')
--   national_shipping_min      numeric(10,2) NOT NULL DEFAULT 0        >= 0
--   national_discount_type     text NULL                               IN ('percentual','fixo')
--   national_discount_value    numeric(10,2) NOT NULL DEFAULT 0        >= 0
--   national_benefit_scope     text NOT NULL DEFAULT 'mais_barata'     IN ('mais_barata','todas')
-- CHECK de linha: strategy='acima_de_valor' ⇒ min > 0; strategy=
-- 'desconto_na_mais_barata' ⇒ type IS NOT NULL AND value > 0 AND
-- (type='fixo' OR (value <= 100 AND value = trunc(value))).
--
-- PRESERVAÇÃO (cópia da regra de hoje, SÓ no instante em que a coluna
-- nasce): um bloco DO confere em information_schema.columns se
-- national_shipping_strategy JÁ EXISTE; se NÃO existe, cria as 5 colunas E
-- copia a partir do free_shipping_min ATUAL (tabela abaixo); se já existe
-- (reaplicação, ou loja que já rodou esta migration antes), NÃO toca em
-- dado nenhum — a escolha que a lojista já fez na tela nova nunca é
-- reescrita por um reapply.
--
--   free_shipping_min hoje | nacional nasce          | alcance
--   0 / NULL               | desligado               | (default: mais_barata)
--   0.01                   | sempre                  | todas
--   < 0                    | por_produto             | todas
--   > 0 (≠ 0.01)           | acima_de_valor, min=fsm | todas
--
-- Com scope 'todas', cada loja cobra no dia seguinte EXATAMENTE o que cobra
-- hoje (o grátis vale em toda opção nacional, como o free_shipping_min
-- fazia sozinho). Loja criada DEPOIS desta migration nasce com o nacional
-- 'desligado' pelo DEFAULT da coluna — igual à regra local de loja nova.
--
-- ESPELHO LEGADO (usado pela RPC nesta migration, e pela edge -- fora do
-- escopo -- quando falta dado): o que a cópia acima produziria a partir do
-- free_shipping_min ATUAL. "Config atual é o espelho" ⇔ strategy =
-- espelho.strategy AND (strategy <> 'acima_de_valor' OR min =
-- free_shipping_min) AND (strategy = 'desligado' OR scope = 'todas') AND
-- type IS NULL.
--
-- v_store_config (security_invoker): as 5 colunas no FIM da view (CREATE OR
-- REPLACE VIEW só aceita coluna nova no fim) — lista copiada, na mesma
-- ordem, da 20261167000000 (nenhuma migration entre ela e esta mexeu na
-- view).
--
-- upsert_store_config: as 5 colunas no INSERT (com os DEFAULTS do
-- contrato — mesma régua de free_shipping_min/shipping_coverage, nunca a
-- forma "sem default" das colunas de texto livre da loja) e no ON CONFLICT
-- pelo padrão CASE WHEN config_json ? 'coluna' — salvar a tela de frete
-- LOCAL não apaga a NACIONAL e vice-versa. Resto do corpo BYTE A BYTE igual
-- ao que a 20261167000000 deixou (preflight abaixo prova o ponto de
-- partida pelo hash do prosrc).
--
-- create_marketplace_order_v23/_v24 (bloco 4, "Regra na RPC" do contrato):
--   - local-delivery/store-pickup: a regra LOCAL (sentinelas de
--     free_shipping_min) passa a valer SÓ para estas duas modalidades —
--     hoje ela decidia para QUALQUER id, inclusive transportadora, antes
--     mesmo de saber qual id foi escolhido. Comportamento de local-delivery
--     e store-pickup é IDÊNTICO ao de hoje (a validade do CEP local já era
--     provada no 2-ter, ANTES deste bloco).
--   - nacional (qualquer outro id): NUNCA mais decidido por
--     free_shipping_min. Exige CEP de entrega conhecido e NÃO local (com
--     p_address_id de conta, o CEP salvo tem de bater com o CEP que o
--     payload manda, quando vier — mesma frase de "cotado para outro CEP"
--     do 2-bis); 'free-shipping-promo' só passa sem cache com a estratégia
--     por_produto vigente e item marcado; os demais ids SEMPRE pela linha
--     do cache, com o carimbo `estrategiaNacional` (gravado pela edge —
--     fora do escopo desta migration) conferido contra as 5 colunas ATUAIS
--     (numérico comparado como numeric; tipoDesconto por IS NOT DISTINCT
--     FROM); carimbo AUSENTE (edge anterior a esta migration) aceito só
--     enquanto a config atual é o espelho legado (então a regra legada
--     decide 0 ou price); divergência em qualquer um dos dois casos ⇒
--     RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: ...' (o front já trata
--     esse prefixo — recota, mesmo classificador da 20261170000000). A
--     checagem '_revisao' da 20261170000000 permanece, intocada.
--   - Todo o resto dos dois corpos é BYTE A BYTE o que a 20261170000000
--     deixou — o preflight abaixo prova o ponto de partida pelo HASH do
--     prosrc.
--
-- Triggers dominio_publico_* (20261140000000): as colunas nacionais NÃO
-- entram no WHEN — são do lojista (a régua de frete), não da frota.
--
-- DADOS EXISTENTES: a cópia legada roda UMA vez, só na primeira aplicação
-- (guarda por information_schema.columns, acima). Nenhuma linha é
-- reescrita numa reaplicação. Sem GRANT novo, sem DROP: CREATE OR REPLACE
-- preserva dono e ACL das três funções.
--
-- PRÉ-REQUISITOS POR BANCO (o preflight ABORTA antes de qualquer mudança se
-- faltar um — nada fica pela metade):
--   - 20261170000000 aplicada (os corpos de v23/_v24 que esta migration
--     substitui) e 20261167000000 aplicada (o corpo de upsert_store_config
--     que esta migration substitui).
--   - exatamente UM overload de cada uma das três funções.
--
-- ORDEM DE APLICAÇÃO (contrato, seção "Janela de publicação"): 1) esta
-- migration; 2) a edge calculate-shipping nova (fora deste pacote); 3) o
-- front. Entre 1 e 2 a edge velha grava opção nacional SEM o carimbo
-- estrategiaNacional — a RPC aceita enquanto a config nacional ainda for o
-- espelho legado (ver "carimbo AUSENTE" acima). Isto mantém a janela sem
-- recusa; depois que a edge nova sobe, todo carimbo existe.
--
-- ATOMICIDADE: SEM BEGIN/COMMIT (regra da casa). scripts/db-apply.cjs
-- aplica o arquivo inteiro numa transação — preflight, colunas, CHECKs,
-- view e os três CREATE OR REPLACE entram juntos ou nenhum entra.
--
-- PROVA DE COMPORTAMENTO: tests/frete-estrategias-database/ (Postgres 17
-- efêmero via Docker, fora do CI automático — ver README da pasta), na RPC
-- REAL: preservação (4 configs legadas → mesmo total antes/depois),
-- reaplicação não sobrescreve, CHECKs recusam, upsert_store_config separa
-- local de nacional, carimbo igual/divergente/ausente, CEP local/sem CEP
-- para id nacional, free-shipping-promo, retirada/local intocados, v23
-- continua recusando transportadora, e o ciclo migration → rollback →
-- reaplicação pelo hash do prosrc.
--
-- ROLLBACK MANUAL: rollback-manual-20261171000000_o_frete_nacional_ganha_estrategia_propria.sql
-- (reaplica os corpos EXATOS da 20261170000000/20261167000000 — byte a
-- byte — e a view sem as 5 colunas; NÃO dropa as colunas — apagaria a
-- configuração que a lojista já salvou). Aplicar PELO PSQL, transação
-- única: psql "$DATABASE_URL" -1 -f <arquivo> -- nunca pelo db-apply (ele
-- registraria o rollback no ledger).

DO $preflight$
DECLARE
  v_hash_v23 text;
  v_hash_v24 text;
  v_hash_upsert text;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v23') <> 1
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v24') <> 1
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'upsert_store_config') <> 1 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: esperava exatamente um overload de create_marketplace_order_v23, _v24 e upsert_store_config -- inventarie antes de aplicar (nunca DROP para arrumar).';
  END IF;

  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash_v23
    FROM pg_proc
   WHERE oid = to_regprocedure('public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)');
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash_v24
    FROM pg_proc
   WHERE oid = to_regprocedure('public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)');
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') INTO v_hash_upsert
    FROM pg_proc
   WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)');

  -- Corpo da 20261170000000 (LF | CRLF) ou o desta migration (LF | CRLF --
  -- reaplicação idempotente).
  IF v_hash_v23 IS NULL OR v_hash_v23 NOT IN (
    '77dd477d32159569e1061a2170d1e852ab0c2272e332e188b11054927ea538b5',
    '26d1e301e142767daa34d8c49bc2fcaffdddd3a2b704cb348385adf0464089de',
    '41a6d704029cf80efc2f803740352fd6b5d7e5797c83c3a783edab76ee677836',
    '5b26a261ac9a92dad38ce6582d70f2fd7b36ee9def5c5b60dc2eb9cb795ad5a5'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo da create_marketplace_order_v23 difere do que a 20261170000000 deixou (hash %) -- aplique antes a 20261170000000 ou capture e revise', COALESCE(v_hash_v23, 'ausente');
  END IF;
  IF v_hash_v24 IS NULL OR v_hash_v24 NOT IN (
    '2462205d062b2d5a5c760b5e99528a95ac45937fd68286ef818eae864882c442',
    'a6e0685ee61f5370a627a31f52e55bc340349bc5c6d651bc32a3f5be19c156a3',
    'e1dfc5ee59b7cf42f85b4c226204fc2330bcc2d4bf2e5686ce9b7f577ca4fef5',
    '4bc424e88f82dd09268679c58519d644293084bf552df4b33b67af380d065cee'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo da create_marketplace_order_v24 difere do que a 20261170000000 deixou (hash %) -- aplique antes a 20261170000000 ou capture e revise', COALESCE(v_hash_v24, 'ausente');
  END IF;

  -- Corpo da 20261167000000 (LF | CRLF) ou o desta migration (LF | CRLF).
  IF v_hash_upsert IS NULL OR v_hash_upsert NOT IN (
    'a6cbf93b1a9cd4b043f01ec0f03e8c2e800f5f53b3167ee2bb6ff915756e2c3b',
    '241037f3d49d97e99e169b9e751748fd462f873dec5562f28fca944651542551',
    '99d4b7e8a104f25b155732a8a2fbe8a6f9f4707cb643ce351e7eb80ce25d4ca6',
    '5b832604ae8eead6c73cd0d0594348cf9e3b538163d396324fbeabca4947493d'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo da upsert_store_config difere do que a 20261167000000 deixou (hash %) -- aplique antes a 20261167000000 ou capture e revise', COALESCE(v_hash_upsert, 'ausente');
  END IF;
END $preflight$;

-- Colunas nacionais: SÓ criadas e SÓ copiadas na primeira aplicação (guarda
-- por information_schema.columns) -- reaplicação nunca reescreve a escolha
-- que a lojista já fez.
DO $colunas_nacionais$
DECLARE
  v_coluna_existe boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'store_config'
       AND column_name = 'national_shipping_strategy'
  ) INTO v_coluna_existe;

  IF NOT v_coluna_existe THEN
    ALTER TABLE public.store_config
      ADD COLUMN national_shipping_strategy text NOT NULL DEFAULT 'desligado',
      ADD COLUMN national_shipping_min numeric(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN national_discount_type text,
      ADD COLUMN national_discount_value numeric(10,2) NOT NULL DEFAULT 0,
      ADD COLUMN national_benefit_scope text NOT NULL DEFAULT 'mais_barata';

    -- Cópia legada (contrato do plano, tabela do cabeçalho acima): a MESMA
    -- sentinela que o bloco 4 da RPC usava sozinho até aqui, na MESMA
    -- ordem (0.01 antes de > 0, porque 0.01 também é > 0).
    UPDATE public.store_config
       SET national_shipping_strategy = CASE
             WHEN free_shipping_min = 0.01 THEN 'sempre'
             WHEN free_shipping_min < 0 THEN 'por_produto'
             WHEN free_shipping_min > 0 THEN 'acima_de_valor'
             ELSE 'desligado'
           END,
           national_shipping_min = CASE
             WHEN free_shipping_min > 0 AND free_shipping_min <> 0.01 THEN free_shipping_min
             ELSE 0
           END,
           national_benefit_scope = CASE
             WHEN COALESCE(free_shipping_min, 0) = 0 THEN 'mais_barata'
             ELSE 'todas'
           END;
    -- national_discount_type fica NULL e national_discount_value fica 0 —
    -- os DEFAULTS da coluna já cobrem (nenhuma das quatro sentinelas
    -- legadas é desconto).
  END IF;
END $colunas_nacionais$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_national_shipping_strategy_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_national_shipping_strategy_check
      CHECK (national_shipping_strategy IN ('desligado','acima_de_valor','sempre','por_produto','desconto_na_mais_barata'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_national_shipping_min_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_national_shipping_min_check
      CHECK (national_shipping_min >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_national_discount_type_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_national_discount_type_check
      CHECK (national_discount_type IS NULL OR national_discount_type IN ('percentual','fixo'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_national_discount_value_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_national_discount_value_check
      CHECK (national_discount_value >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_national_benefit_scope_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_national_benefit_scope_check
      CHECK (national_benefit_scope IN ('mais_barata','todas'));
  END IF;
END $$;

-- CHECK de linha (contrato): acima_de_valor exige mínimo positivo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_national_acima_de_valor_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_national_acima_de_valor_check
      CHECK (national_shipping_strategy <> 'acima_de_valor' OR national_shipping_min > 0);
  END IF;
END $$;

-- CHECK de linha (contrato): desconto_na_mais_barata exige tipo, valor
-- positivo, e percentual só até 100 e inteiro (fixo não tem teto).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_national_desconto_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_national_desconto_check
      CHECK (
        national_shipping_strategy <> 'desconto_na_mais_barata'
        OR (
          national_discount_type IS NOT NULL
          AND national_discount_value > 0
          AND (
            national_discount_type = 'fixo'
            OR (national_discount_value <= 100 AND national_discount_value = trunc(national_discount_value))
          )
        )
      );
  END IF;
END $$;

-- v_store_config: a lista da 20261167000000, na MESMA ordem, + as 5 colunas
-- nacionais no FIM (CREATE OR REPLACE VIEW só aceita coluna nova no fim).
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
    store_description,
    national_shipping_strategy,
    national_shipping_min,
    national_discount_type,
    national_discount_value,
    national_benefit_scope
   FROM store_config
  WHERE id = 1;

-- Corpo: o vivo da 20261167000000 com as ÚNICAS trocas comentadas abaixo —
-- nenhuma outra linha mudou (o preflight acima garantiu o ponto de
-- partida):
--   (a) lista de colunas do INSERT: + as 5 colunas nacionais (T1)
--   (b) VALUES do INSERT: COALESCE com os defaults do contrato — igual à
--       forma de free_shipping_min/shipping_coverage, nunca a forma "sem
--       default de fábrica" das colunas de texto livre da loja
--   (c) ON CONFLICT: só sobrescreve a coluna que veio no payload (mesmo
--       padrão CASE WHEN config_json ? 'coluna' das demais)
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
    store_address, store_description,
    national_shipping_strategy, national_shipping_min,
    national_discount_type, national_discount_value, national_benefit_scope
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
    config_json->>'store_description',
    -- T1 (20261171000000): com default de fábrica — o candidato do INSERT
    -- nasce com a MESMA sentinela do CHECK/DEFAULT da coluna (mesma régua
    -- de free_shipping_min/shipping_coverage acima, nunca a forma "sem
    -- default" das colunas de texto livre da loja).
    COALESCE(config_json->>'national_shipping_strategy', 'desligado'),
    COALESCE((config_json->>'national_shipping_min')::numeric, 0),
    config_json->>'national_discount_type',
    COALESCE((config_json->>'national_discount_value')::numeric, 0),
    COALESCE(config_json->>'national_benefit_scope', 'mais_barata')
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
    -- T1 (20261171000000): a tela de frete LOCAL e a tela de frete NACIONAL
    -- salvam separadamente — o CASE por coluna é o que garante que salvar
    -- uma não apaga a outra (mesmo aceite das duas linhas acima).
    national_shipping_strategy = CASE WHEN config_json ? 'national_shipping_strategy'
      THEN config_json->>'national_shipping_strategy'
      ELSE store_config.national_shipping_strategy END,
    national_shipping_min = CASE WHEN config_json ? 'national_shipping_min'
      THEN (config_json->>'national_shipping_min')::numeric
      ELSE store_config.national_shipping_min END,
    national_discount_type = CASE WHEN config_json ? 'national_discount_type'
      THEN config_json->>'national_discount_type'
      ELSE store_config.national_discount_type END,
    national_discount_value = CASE WHEN config_json ? 'national_discount_value'
      THEN (config_json->>'national_discount_value')::numeric
      ELSE store_config.national_discount_value END,
    national_benefit_scope = CASE WHEN config_json ? 'national_benefit_scope'
      THEN config_json->>'national_benefit_scope'
      ELSE store_config.national_benefit_scope END,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v23(p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_item_name text;
    v_rows_affected integer;

    v_db_price numeric;
    v_db_stock integer;
    v_calculated_subtotal numeric := 0;
    v_calculated_total numeric := 0;
    v_discount_amount numeric := 0;
    v_coupon_id uuid;

    v_store_config RECORD;
    v_shipping_validated numeric;
    v_frete_gratis boolean;
    v_has_free_shipping_item boolean := false;
    v_free_shipping_min numeric;
    v_dest_cep text;

    -- R3-3 (20261170000000): a revisão das credenciais de frete carimbada
    -- na opção de cache no instante da cotação (v_revisao_credenciais), e a
    -- revisão ATUAL da loja (v_revisao_atual, lida de
    -- store_shipping_credentials provider='_revisao' logo abaixo, dentro do
    -- ramo de cotação de transportadora). As duas ficam NULL fora desse
    -- ramo -- local-delivery e store-pickup não usam cache de cotação.
    v_revisao_credenciais text;
    v_revisao_atual text;

    -- T1 (20261171000000, estratégias de frete local e nacional): o
    -- carimbo estrategiaNacional da opção de cache (v_estrategia_nacional,
    -- lido na MESMA linha de v_revisao_credenciais) e a estratégia
    -- "espelho" que a cópia legada teria produzido a partir do
    -- free_shipping_min ATUAL (v_espelho_strategy, calculada uma única vez
    -- logo no início do bloco 4) -- usadas só no ramo de cotação de
    -- transportadora, para aceitar cotação sem carimbo (edge anterior a
    -- esta migration) apenas enquanto a configuração nacional ainda é o
    -- espelho legado.
    v_estrategia_nacional jsonb;
    v_espelho_strategy text;
    -- EMENDA (revisão T1, 23/09): o subtotal (preços do BANCO) com que a
    -- edge aplicou a estratégia no instante da cotação, lido da MESMA linha
    -- do cache -- usado só para pegar carrinho que mudou de lado do mínimo
    -- (acima_de_valor/desconto_na_mais_barata) DEPOIS de cotado.
    v_subtotal_cotacao numeric;

    v_coupon_type text;
    v_cupom_recusado RECORD;
    v_coupon_val numeric;

    -- O PORTÃO DE ENTREGA (20261039000000): onde se cotou × onde se entrega.
    v_cep_de_cotacao text;
    v_cep_de_entrega text;

    -- 2-ter (20261168000000, revisão B4): o id da opção de entrega
    -- NORMALIZADO uma única vez — NULLIF(btrim(...)) — lido por TODAS as
    -- comparações do bloco 2-ter (NULL, flat-fee, local-delivery). O
    -- bloco 4 segue lendo o parâmetro cru, VERBATIM (fora do escopo).
    v_opcao text := NULLIF(btrim(p_shipping_option_id), '');
BEGIN

    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO (laudo caça-bugs do molde, 31/08/2026, A1):
    -- a rede pode cair DEPOIS do commit deste pedido. A retentativa honesta
    -- (mesmo clique repetido, F5, mesmo navegador) REPETE a chave da compra
    -- e tem de receber o pedido que JÁ NASCEU — não criar um gêmeo com
    -- estoque e cupom debitados em dobro. Convidado não tem user_id para
    -- amarrar: a chave uuid aleatória É o segredo da compra. Quem está
    -- logado só recupera pedido próprio.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_order_id
          FROM public.marketplace_orders
         WHERE idempotency_key = p_idempotency_key
           AND (v_user_id IS NULL OR user_id IS NOT DISTINCT FROM v_user_id);
        IF v_order_id IS NOT NULL THEN
            RETURN v_order_id;
        END IF;
    END IF;

    -- 1. Address Ownership Check (Only if user is logged in)
    IF p_address_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
        END IF;
    END IF;

    -- 2. Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- 2-bis. O PORTÃO DE ENTREGA MORA AQUI (laudo caça-bugs do molde,
    -- 31/08/2026, A2 + item E). Até hoje a regra do convidado (só entrega
    -- local, decisão do Gabriel de 30/08) e a cobertura da loja
    -- (store_config.shipping_coverage) existiam SÓ na tela: chamando esta
    -- RPC direto, QUALQUER CEP passava — e o caminho flat-fee-* nem olhava
    -- CEP. O comentário do cep-local.ts ("a decisão final é do servidor")
    -- era aspiração; a partir daqui é verdade.
    --
    -- CEP DE ENTREGA verdadeiro, na ordem de confiança: o CEP digitado do
    -- convidado (address_data.cep — é para ONDE a mercadoria vai), o CEP do
    -- endereço do logado (linha própria, dono provado no passo 1), e só por
    -- último o CEP da cotação. O CEP DE COTAÇÃO é o que o frete cobrado
    -- promete — os dois sendo iguais é o que a reconciliação cobra.
    v_cep_de_cotacao := NULLIF(regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g'), '');
    v_cep_de_entrega := NULLIF(regexp_replace(COALESCE(p_address_data->>'cep', ''), '\D', '', 'g'), '');
    IF v_cep_de_entrega IS NULL AND v_user_id IS NOT NULL AND p_address_id IS NOT NULL THEN
        SELECT NULLIF(regexp_replace(cep, '\D', '', 'g'), '') INTO v_cep_de_entrega
          FROM public.user_addresses
         WHERE id = p_address_id AND user_id = v_user_id;
    END IF;
    IF v_cep_de_entrega IS NULL THEN
        v_cep_de_entrega := v_cep_de_cotacao;
    END IF;

    -- RECONCILIAÇÃO (item E do laudo): frete cotado para A não pode cobrar
    -- entrega em B. Cotação AUSENTE não contradiz destino nenhum — frete
    -- grátis e taxa fixa sem passagem pela calculadora chegam aqui sem ela,
    -- e o portão de baixo é quem policia esses caminhos.
    IF v_cep_de_cotacao IS NOT NULL AND v_cep_de_entrega IS NOT NULL
       AND v_cep_de_cotacao <> v_cep_de_entrega THEN
        RAISE EXCEPTION 'O frete foi cotado para outro CEP. Volte ao carrinho, calcule o frete para o CEP de entrega e finalize de novo.'
            USING DETAIL = format('Cotação para o CEP %s, entrega para o CEP %s.', v_cep_de_cotacao, v_cep_de_entrega);
    END IF;

    -- CONVIDADO SÓ ENTREGA LOCAL (decisão do Gabriel, 30/08/2026): fora da
    -- área local exige conta — sem cadastro não existe rastreio honesto do
    -- pedido. Sem origem configurada, o aviso é o certo: a loja ainda nem
    -- consegue cotar entrega (B1 do laudo).
    IF v_user_id IS NULL THEN
        IF v_cep_de_entrega IS NULL THEN
            RAISE EXCEPTION 'Informe o CEP de entrega.'
                USING DETAIL = 'Pedido de convidado sem CEP de entrega nenhum.';
        END IF;
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Convidado exige entrega local, mas a loja não tem CEP de origem.';
        END IF;
        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
            RAISE EXCEPTION 'Compra sem conta é só com entrega na cidade da loja. Entre na sua conta para receber em outro endereço.'
                USING DETAIL = format('CEP %s fora da faixa local (origem %s).', v_cep_de_entrega, v_store_config.origin_cep);
        END IF;
    END IF;

    -- COBERTURA LOCAL (shipping_coverage = 'local') VALE PARA TODOS: loja
    -- que só entrega na cidade não aceita pedido para fora — nem de cliente
    -- logado, nem de frete grátis passando por cima do portão. Com entrega
    -- desconhecida (nem endereço, nem cotação), falha fechada.
    IF v_store_config.shipping_coverage = 'local' THEN
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Cobertura local exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL THEN
            RAISE EXCEPTION 'Informe o CEP de entrega.'
                USING DETAIL = 'Pedido com cobertura local e sem CEP de entrega nenhum.';
        END IF;
        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
            RAISE EXCEPTION 'Esta loja só faz entrega na cidade dela. Confira o CEP de entrega.'
                USING DETAIL = format('CEP %s fora da faixa local com cobertura local.', v_cep_de_entrega);
        END IF;
    END IF;

    -- 2-ter. A MODALIDADE DO FRETE MANDA NO MEIO DE PAGAMENTO (regra do
    -- dono, 21/09/2026): envio por TRANSPORTADORA — qualquer id que não
    -- seja "local-delivery" (melhor-envio-*, frenet-*, o gratuito externo
    -- "free-shipping-promo" que a edge calculate-shipping devolve no
    -- caminho de transportadora; INDEPENDENTE DO PREÇO) — exige pagamento
    -- ANTECIPADO. Tudo aqui é provado ANTES do ramo do frete grátis do
    -- bloco 4: o preset gratuito zera o preço SEM validar o id da opção,
    -- e era por esse buraco que um 'local-delivery' forjado (ou um pedido
    -- de transportadora "na entrega", ou um pedido de fora da cidade SEM
    -- escolha nenhuma) nascia com frete R$ 0.
    -- SEM ESCOLHA (EMENDA desta migration): opção ausente NÃO nasce, em
    -- QUALQUER CEP — com ou sem frete grátis, o preset gratuito do bloco 4
    -- não substitui a escolha. Mesma frase do ELSIF do bloco 4: o
    -- classificador do front (src/lib/recusaDoPedido.ts) casa por ela —
    -- leva de volta ao carrinho, onde a calculadora está.
    -- NORMALIZAÇÃO (revisão B4 do parecer): TODAS as comparações daqui
    -- leem v_opcao (o id com btrim/NULLIF aplicados UMA vez, no DECLARE) —
    -- ' local-delivery' e ' flat-fee-1' (espaços de sobra) caem na regra
    -- CERTA. 'LOCAL-DELIVERY' em maiúsculas NÃO casa 'local-delivery' e
    -- cai no ramo transportadora: fail-closed (recusa em vez de aceitar),
    -- aceitável e documentado. O bloco 4 abaixo continua VERBATIM lendo o
    -- parâmetro cru — fora do escopo desta migration.
    IF v_opcao IS NULL THEN
        RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'
            USING DETAIL = 'Pedido sem opção de entrega: o servidor não inventa frete nem cobra taxa da loja.';
    ELSIF v_opcao LIKE 'flat-fee-%' THEN
        -- Mesma frase do ELSIF antigo do bloco 4, agora provada ANTES do
        -- gratuito: taxa fixa não existe mais (payload velho ou forjado).
        RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
            USING DETAIL = format('O id %s é de taxa fixa, que não existe mais; o servidor não cobra shipping_fee da loja.', v_opcao);
    ELSIF v_opcao = 'local-delivery' THEN
        -- Localidade com o CEP DE ENTREGA verificado no servidor
        -- (v_cep_de_entrega: endereço de dono provado no passo 1, o
        -- CEP digitado do convidado, ou a cotação como último recurso)
        -- contra origin_cep/local_cep_range da store_config — o mesmo
        -- public.is_local_cep do ELSIF do bloco 4 (que continua lá),
        -- só que ANTES do gratuito. FAIL-CLOSED nas duas pontas (revisão
        -- A1 do parecer): origem AUSENTE é recusada ANTES do teste — o
        -- SELECT INTO do passo 2 não reclama linha ausente. CONTRATO FONTE
        -- da is_local_cep (baseline
        -- 20260806000000_baseline_do_schema_vivo.sql:3128): IMMUTABLE e
        -- NÃO STRICT — origem/destino vazio devolve FALSE (nunca NULL) e
        -- faixa NULL é SEMÂNTICA VÁLIDA (compara os 5 primeiros dígitos de
        -- origem e destino; NÃO há, nem deve haver, bloqueio de faixa
        -- NULL). Aqui o predicado é a forma fail-closed —
        -- COALESCE(..., false) = false — defesa em profundidade: se a
        -- função um dia virar STRICT ou devolver NULL, NULL vira false,
        -- que RECUSA em vez de passar.
        -- A frase da origem ausente é a MESMA JÁ CLASSIFICADA do 2-bis
        -- (entrar_na_conta no front). O 2-bis pré-existente acima não foi
        -- expandido (gate de verificação separado, fora do escopo).
        -- Sem CEP de entrega nenhum: falha fechada. Mesma frase do ELSIF:
        -- o classificador do front (src/lib/recusaDoPedido.ts) casa por
        -- ela. O DETAIL faz local_cep_range::text EXPLÍCITO (revisão A2):
        -- sem o cast, coluna numérica faria o '' da COALESCE resolver
        -- para numeric e o erro de cast só apareceria NO DIA da recusa.
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Entrega local exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL
           OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false THEN
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('id local-delivery com CEP de entrega %s fora da área local (origem %s, faixa %s) — provado antes do ramo do frete grátis.',
                    COALESCE(v_cep_de_entrega, 'ausente'), COALESCE(v_store_config.origin_cep, ''), COALESCE(v_store_config.local_cep_range::text, ''));
        END IF;
    ELSIF v_opcao = 'store-pickup' THEN
        -- RETIRADA NA LOJA (20261169000000): a cliente busca o pedido no
        -- endereço físico da loja — frete ZERO, e o pagamento segue as
        -- MESMAS regras da entrega local (é modalidade da própria loja,
        -- não de transportadora: nenhuma restrição de meio aqui, igual ao
        -- ramo local-delivery acima). O servidor REVALIDA, fail-closed, os
        -- requisitos que a edge calculate-shipping usa para OFERECER a
        -- opção — a oferta da edge é conveniência, a regra mora aqui:
        --   1. id CANÔNICO: o bloco 4 e o customer_data leem o parâmetro
        --      CRU; ' store-pickup' (espaço de sobra) validaria aqui pelo
        --      v_opcao e nasceria sem o retrato do endereço — recusado.
        --   2. a loja HABILITOU a retirada: a chave 'store-pickup' em
        --      enabled_shipping_methods. NULL/vazio = desligada. O
        --      COALESCE(... = ANY(...), false) é a forma fail-closed: um
        --      elemento NULL no array faz o = ANY devolver NULL quando a
        --      chave não está lá, e NULL não pode passar por "habilitada".
        --   3. a loja tem ENDEREÇO FÍSICO (store_address com btrim não
        --      vazio, coluna da 20261167000000) — é ele que vai para o
        --      pedido como pickup_address.
        --   4. o CEP de entrega é LOCAL (a MESMA prova do local-delivery,
        --      com as mesmas frases já classificadas pelo front): a
        --      retirada é oferta para quem é da área da loja.
        IF p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = format('id de retirada fora da forma canônica: %s.', p_shipping_option_id);
        END IF;
        IF COALESCE('store-pickup' = ANY(COALESCE(v_store_config.enabled_shipping_methods, '{}'::text[])), false) = false THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = 'A loja não habilitou a retirada na loja (chave store-pickup ausente de enabled_shipping_methods).';
        END IF;
        IF NULLIF(btrim(COALESCE(v_store_config.store_address, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = 'Retirada na loja exige o endereço físico da loja (store_address) preenchido.';
        END IF;
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Retirada na loja exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL
           OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false THEN
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('id store-pickup com CEP de entrega %s fora da área local (origem %s, faixa %s) — a retirada na loja é só para a área local.',
                    COALESCE(v_cep_de_entrega, 'ausente'), COALESCE(v_store_config.origin_cep, ''), COALESCE(v_store_config.local_cep_range::text, ''));
        END IF;
    ELSE
        -- A v23 é a RPC do pagamento NA ENTREGA: não gera cobrança
        -- nem grava 'aguardando'/expires_at — transporte só combina
        -- com a v24 + online (PIX pago no app). Transportadora é
        -- RECUSADA SEMPRE aqui, inclusive com p_payment_method
        -- = 'online': quem paga antecipado entra pela v24.
        RAISE EXCEPTION 'Envio por transportadora exige pagamento antecipado. Pague com PIX no app para finalizar este envio.'
            USING DETAIL = format('A RPC do pagamento na entrega (v23) não aceita envio por transportadora; opção recebida: %s.', v_opcao);
    END IF;

    -- 3. Validation Loop (Price, Stock Lock, Subtotal Calculation)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida para um dos itens.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome, p.frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
              AND v.active = true AND p.ativo = true
            FOR NO KEY UPDATE OF v;
        ELSE
            -- A trava de linha vem PRIMEIRO: o SELECT abaixo ja exige
            -- `ativo = true` e trava a linha com `FOR NO KEY UPDATE`, entao a
            -- guarda que vem depois nao tem janela de corrida contra um
            -- UPDATE concorrente em `produtos.ativo`. Com a guarda ANTES (a
            -- forma anterior, com EXISTS + JOIN em `produtos`), ela e o
            -- SELECT tomavam SNAPSHOTS DIFERENTES sob READ COMMITTED: se a
            -- lojista republicasse o produto e commitasse ENTRE os dois
            -- comandos, a guarda nao disparava (produto estava inativo no
            -- primeiro snapshot) e o SELECT achava o produto ativo no
            -- segundo -- o item era vendido pelo preco/estoque do produto
            -- base mesmo tendo variacao ativa. Nesta ordem nao ha segundo
            -- snapshot: os dois leem a MESMA linha, ja travada.
            SELECT preco_venda, estoque, nome, frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos
            WHERE id = v_product_id AND ativo = true
            FOR NO KEY UPDATE;

            -- 🔴 A GUARDA QUE FALTAVA. Sem ela, `variant_id: null` num produto
            -- QUE TEM variacao caia aqui e era aceito: preco de `preco_venda`
            -- em vez de `price_override`, e baixa no `estoque` agregado em vez
            -- do `stock_increment` da variacao escolhida. O pedido nascia sem
            -- tamanho, a lojista nao tinha o que separar, e o estoque daquele
            -- tamanho nunca descia -- vendendo de novo o que ja acabou.
            --
            -- Ate hoje quem segurava isso eram QUATRO copias de um `if` no
            -- cliente. Cada tela nova reabre o buraco, e nenhuma delas alcanca
            -- quem chama a RPC direto.
            --
            -- `v_db_price IS NOT NULL` e o teste de "produto ativo" -- substitui
            -- o JOIN com `produtos` que a guarda tinha antes de mudar de lugar.
            -- Se o SELECT acima nao achou linha (produto inativo), v_db_price
            -- fica NULL, a guarda nem dispara (curto-circuito do AND), e quem
            -- recusa e o `IF v_db_price IS NULL` logo abaixo, com "Produto %
            -- nao disponivel" -- a mensagem certa para um produto fora da
            -- vitrine, nao "Escolha uma variacao" (instrucao impossivel de
            -- seguir para quem nao pode comprar aquele produto de jeito
            -- nenhum). `v.active = true` sozinho, sem JOIN em `produtos`, e o
            -- mesmo predicado que o ramo de cima usa para ACEITAR uma
            -- variacao -- produto cujas variacoes foram TODAS desativadas
            -- continua vendavel pelo produto base.
            IF v_db_price IS NOT NULL AND EXISTS (
                SELECT 1
                FROM public.product_variants v
                WHERE v.product_id = v_product_id
                  AND v.active = true
            ) THEN
                RAISE EXCEPTION 'Escolha uma variação para o produto %.',
                    COALESCE((SELECT nome FROM public.produtos WHERE id = v_product_id), 'selecionado')
                    USING DETAIL = 'variant_id ausente em produto com variacao ativa; o item foi recusado no servidor.';
            END IF;
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto % não disponível.', COALESCE(v_item_name, 'não encontrado'); END IF;
        IF v_db_stock < v_quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)', v_item_name, v_db_stock, v_quantity;
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
        IF v_frete_gratis = true THEN
            v_has_free_shipping_item := true;
        END IF;
    END LOOP;

    -- 4. Shipping Calculation
    -- FRETE V2 (20261081000000) + T1 (20261171000000, estratégias de frete
    -- local e nacional): a regra de frete grátis por SENTINELA
    -- (free_shipping_min) passa a valer SÓ para as duas modalidades da
    -- própria loja -- local-delivery e store-pickup. Cotação de
    -- transportadora (qualquer outro id) NUNCA mais é decidida por
    -- free_shipping_min: ela é sempre a linha do cache, com o carimbo
    -- `estrategiaNacional` conferido contra as 5 colunas nacionais atuais
    -- (ver o ramo `ELSIF p_destination_cep IS NOT NULL` abaixo). A marcação
    -- de item grátis (v_has_free_shipping_item) continua vindo do BANCO —
    -- lida no loop de validação pelo product_id, nunca do payload.
    -- Sentinelas da regra LOCAL (mesmas do front, só para local-delivery e
    -- store-pickup):
    --   < 0    -> por_produto: só item marcado zera o frete
    --   = 0.01 -> sempre: todo pedido é grátis
    --   > 0    -> acima_de_valor: subtotal atinge o limiar (SEM trava de
    --             login — a trava v_user_id IS NOT NULL morreu: convidado
    --             tem o mesmo direito; a entrega dele é local e o portão
    --             de CEP continua nos ELSIFs abaixo)
    --   0/NULL -> desligado: nada é grátis aqui (cai na regra do id)
    v_free_shipping_min := COALESCE(v_store_config.free_shipping_min, 0);

    -- T1: a estratégia que a cópia legada (20261171000000) teria produzido
    -- a partir do free_shipping_min ATUAL -- é o "espelho legado" que a
    -- checagem do carimbo AUSENTE (edge anterior a esta migration) usa mais
    -- abaixo. Mesma sentinela do quadro acima, na mesma ordem: 0.01 antes de
    -- > 0, porque 0.01 também é > 0.
    v_espelho_strategy := CASE
        WHEN v_free_shipping_min = 0.01 THEN 'sempre'
        WHEN v_free_shipping_min < 0 THEN 'por_produto'
        WHEN v_free_shipping_min > 0 THEN 'acima_de_valor'
        ELSE 'desligado'
    END;

    IF p_shipping_option_id IS NULL OR p_shipping_option_id = '' THEN
        RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'
            USING DETAIL = 'Pedido sem opção de entrega: o servidor não inventa frete nem cobra taxa da loja.';

    -- FRETE V2 EMENDA (03/09): o id `flat-fee-%` deixou de ser escolha válida
    -- — a taxa fixa morreu na edge (calculate-shipping) e aqui no servidor.
    -- Recebê-lo é payload velho ou forjado: falha fechada, NUNCA o
    -- shipping_fee da loja.
    ELSIF p_shipping_option_id LIKE 'flat-fee-%' THEN
        RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
            USING DETAIL = format('O id %s é de taxa fixa, que não existe mais; o servidor não cobra shipping_fee da loja.', p_shipping_option_id);

    -- T1: a regra LOCAL (sentinelas de free_shipping_min) mora só aqui e no
    -- ramo store-pickup abaixo -- id de transportadora nunca mais passa por
    -- ela. A validade do CEP local já foi provada no 2-ter, ANTES deste
    -- bloco; aqui só decide o VALOR: grátis pela sentinela, senão a taxa
    -- configurada (COALESCE(local_delivery_fee, 0), como sempre).
    ELSIF p_shipping_option_id = 'local-delivery' THEN
        v_dest_cep := regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g');
        IF public.is_local_cep(v_store_config.origin_cep, v_dest_cep, v_store_config.local_cep_range) THEN
            IF (v_free_shipping_min < 0 AND v_has_free_shipping_item = true)
               OR v_free_shipping_min = 0.01
               OR (v_free_shipping_min > 0 AND v_calculated_subtotal >= v_free_shipping_min)
            THEN
                v_shipping_validated := 0;
            ELSE
                v_shipping_validated := COALESCE(v_store_config.local_delivery_fee, 0);
            END IF;
        ELSE
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('CEP %s fora da faixa local configurada.', v_dest_cep);
        END IF;

    -- RETIRADA NA LOJA (20261169000000): frete ZERO, sempre -- T1 não muda
    -- este ramo, já era grátis. Os requisitos (id canônico, retirada
    -- habilitada, endereço físico, CEP local) já foram provados no 2-ter,
    -- ANTES do ramo do frete grátis. O CEP de destino é gravado como no
    -- local-delivery (é o CEP da cliente que provou a área). Fica ANTES do
    -- ramo do cache: 'store-pickup' nunca é cotação gravada.
    ELSIF p_shipping_option_id = 'store-pickup' THEN
        v_dest_cep := regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g');
        v_shipping_validated := 0;

    ELSIF p_destination_cep IS NOT NULL THEN
        v_dest_cep := regexp_replace(p_destination_cep, '\D', '', 'g');

        -- T1, passo 1 do contrato "Regra na RPC": nacional exige CEP de
        -- entrega CONHECIDO e NÃO local -- transportadora não atende a
        -- própria cidade da loja (quem mora lá usa local-delivery ou
        -- store-pickup). CEP vazio (garbage no payload) e CEP local caem na
        -- MESMA frase: o cliente volta ao carrinho e escolhe de novo, sem
        -- distinguir o motivo (defesa em profundidade, como o resto do
        -- caminho do dinheiro).
        IF v_dest_cep = '' OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_dest_cep, v_store_config.local_cep_range), false) THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = format('id nacional %s exige CEP de entrega conhecido e fora da área local; CEP recebido: %s.', p_shipping_option_id, COALESCE(NULLIF(v_dest_cep, ''), 'ausente'));
        END IF;

        -- T1: com endereço DE CONTA (p_address_id, dono já provado no passo
        -- 1) e o payload também mandando um CEP em p_address_data, os dois
        -- têm de ser o MESMO endereço -- sem isto, um p_address_data.cep
        -- forjado (diferente do que está salvo) escapava da reconciliação
        -- do 2-bis (que só compara cotação × entrega, e prioriza
        -- p_address_data.cep sobre o CEP salvo quando os dois vêm). Mesma
        -- frase da reconciliação do 2-bis.
        IF p_address_id IS NOT NULL AND v_user_id IS NOT NULL
           AND NULLIF(btrim(COALESCE(p_address_data->>'cep', '')), '') IS NOT NULL
           AND EXISTS (
               SELECT 1 FROM public.user_addresses
                WHERE id = p_address_id AND user_id = v_user_id
                  AND regexp_replace(cep, '\D', '', 'g') <> regexp_replace(p_address_data->>'cep', '\D', '', 'g')
           )
        THEN
            RAISE EXCEPTION 'O frete foi cotado para outro CEP. Volte ao carrinho, calcule o frete para o CEP de entrega e finalize de novo.'
                USING DETAIL = format('O endereço %s tem CEP salvo diferente do CEP enviado no pedido.', p_address_id);
        END IF;

        -- T1, passo 2 do contrato: o atalho por produto NUNCA passa pelo
        -- cache -- ele só existe quando a estratégia nacional vigente é
        -- por_produto e algum item do carrinho está marcado (o mesmo
        -- v_has_free_shipping_item do loop de validação, passo 3). Qualquer
        -- outra combinação com este id é payload velho ou forjado: a
        -- estratégia mudou depois da cotação, ou o front nunca devia ter
        -- oferecido esta opção.
        IF p_shipping_option_id = 'free-shipping-promo' THEN
            IF v_store_config.national_shipping_strategy = 'por_produto' AND v_has_free_shipping_item = true THEN
                v_shipping_validated := 0;
            ELSE
                RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                    USING DETAIL = 'free-shipping-promo só é válido com a estratégia nacional por_produto vigente e item marcado no carrinho.';
            END IF;

        ELSE
            -- T1, passo 3 do contrato: demais ids, SEMPRE pela linha do
            -- cache -- nunca mais pulam para a sentinela local. Preço sai
            -- do que o SERVIDOR gravou, nunca do que o cliente enviou.
            SELECT (opt->>'price')::numeric, opt->>'revisaoCredenciais', opt->'estrategiaNacional', (opt->>'subtotalCotacao')::numeric
              INTO v_shipping_validated, v_revisao_credenciais, v_estrategia_nacional, v_subtotal_cotacao
              FROM public.shipping_quotes_cache q,
                   LATERAL jsonb_array_elements(q.options) AS opt
             WHERE regexp_replace(q.destination_cep, '\D', '', 'g') = v_dest_cep
               AND regexp_replace(COALESCE(q.origin_cep, ''), '\D', '', 'g')
                   = regexp_replace(COALESCE(v_store_config.origin_cep, ''), '\D', '', 'g')
               AND q.created_at > now() - interval '24 hours'
               AND opt->>'id' = p_shipping_option_id
               -- 🔴 A COTACAO TEM DE SER DO CARRINHO QUE ESTA SENDO COMPRADO.
               -- Sem esta condicao dava para cotar o frete com um carrinho pequeno,
               -- encher o carrinho e fechar o pedido pagando o frete do pequeno --
               -- a diferenca saindo do bolso da lojista.
               --
               -- Comparo CONJUNTO contra CONJUNTO, nao texto contra texto. O
               -- `cart_hash` e serializado pela edge function em JavaScript
               -- (getCartHash, calculate-shipping/index.ts): ordenacao por
               -- localeCompare, variante vazia como '', quantidade ausente como 1.
               -- Recompor esse texto aqui obrigaria o banco a reproduzir cada um
               -- desses detalhes, e CADA UM e uma chance de recusar pedido HONESTO
               -- no ultimo clique. Desmontando os dois lados em (produto, variante,
               -- quantidade) e ordenando AQUI, a ordem do JavaScript deixa de
               -- importar. (Medido em 22/08/2026: neste banco localeCompare e o
               -- ORDER BY do Postgres CONCORDAM, en_US.UTF-8 -- mas isso e
               -- propriedade da collation, nao do desenho, e este app e um molde
               -- que nasce em bancos novos.)
               --
               -- Usa `=`, nao IS NOT DISTINCT FROM: com entrada estragada o
               -- resultado e NULL, a linha nao casa, e o pedido e RECUSADO. Falha
               -- fechado, como o resto do caminho do dinheiro.
               AND (SELECT array_agg(x ORDER BY x) FROM (
                      SELECT split_part(t, ':', 1) || ':' ||
                             split_part(t, ':', 2) || ':' ||
                             split_part(t, ':', 3) AS x
                        FROM unnest(string_to_array(q.cart_hash, ',')) AS t
                    ) itens_da_cotacao)
                 = (SELECT array_agg(x ORDER BY x) FROM (
                      SELECT COALESCE(i->>'product_id', '') || ':' ||
                             COALESCE(i->>'variant_id', '') || ':' ||
                             COALESCE(i->>'quantity', '1') AS x
                        FROM jsonb_array_elements(p_items) AS i
                    ) itens_do_pedido)
             ORDER BY q.created_at DESC
             LIMIT 1;

            IF v_shipping_validated IS NULL THEN
                RAISE EXCEPTION 'A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.'
                    USING DETAIL = format(
                        'Sem cotação válida nas últimas 24h para cep=%s, opção=%s -- ou a cotação encontrada era de OUTRO carrinho.',
                        v_dest_cep, p_shipping_option_id
                    );
            END IF;

            -- R3-3 (20261170000000, EMENDA R3 do root): apagar o cache (R2-2) só
            -- ESTREITA a janela -- uma cotação em voo pode gravar DEPOIS da
            -- limpeza. A garantia final mora aqui: se a loja já tem uma linha
            -- '_revisao' (upsert atômico de save_credentials/save_active_providers,
            -- R3-1), a revisão que a opção carregou no instante da cotação
            -- (v_revisao_credenciais, gravada pela edge em R3-2) tem de casar com
            -- a revisão ATUAL. Sem a linha '_revisao' (loja em legado, ou banco
            -- antes do primeiro save da edge), esta checagem NEM RODA -- o
            -- comportamento fica IDÊNTICO ao de hoje.
            SELECT credentials->>'revisao' INTO v_revisao_atual
              FROM public.store_shipping_credentials
             WHERE provider = '_revisao';

            IF v_revisao_atual IS NOT NULL
               AND v_revisao_credenciais IS DISTINCT FROM v_revisao_atual THEN
                RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                    USING DETAIL = format('Revisão da cotação: %s. Revisão atual da loja: %s.', COALESCE(v_revisao_credenciais, 'ausente'), v_revisao_atual);
            END IF;

            -- T1, passo 3 (continuação) + EMENDA (revisão T1, 23/09): o
            -- carimbo estrategiaNacional é a segunda trava independente da
            -- '_revisao' acima -- ela cobre credencial/provedor, esta cobre
            -- a ESTRATÉGIA DE PREÇO (frete grátis e desconto nacional).
            -- v_shipping_validated já é o `price` (final, com a estratégia
            -- já aplicada pela edge no instante da cotação); o que falta é
            -- confirmar que a estratégia (e, para acima_de_valor/
            -- desconto_na_mais_barata, o subtotal) não mudou desde então.
            --
            -- Três situações, na ordem certa -- NÃO é só "presente ou
            -- ausente": a CHAVE pode nem existir no JSON (SQL NULL de
            -- verdade, `opt->'estrategiaNacional'` sem a chave -- edge
            -- anterior a esta migration) OU pode existir com um valor que
            -- não é um objeto completo (json null, array, `{}`, ou um
            -- objeto faltando campo -- carimbo forjado ou edge com bug).
            -- Só o primeiro caso tem o espelho legado como saída; os outros
            -- dois recusam direto.
            IF v_estrategia_nacional IS NULL THEN
                -- Carimbo VERDADEIRAMENTE AUSENTE (a chave nem existe no
                -- JSON da opção -- edge anterior a esta migration): aceito
                -- só se a configuração nacional ATUAL ainda é o espelho
                -- legado do free_shipping_min -- o mesmo predicado do
                -- contrato (seção "Espelho legado" do plano). Fora do
                -- espelho, a lojista já mexeu na estratégia nacional e uma
                -- cotação sem carimbo não tem como provar que respeita a
                -- regra nova.
                IF NOT (
                    v_store_config.national_shipping_strategy = v_espelho_strategy
                    AND (v_store_config.national_shipping_strategy <> 'acima_de_valor' OR v_store_config.national_shipping_min = v_free_shipping_min)
                    AND (v_store_config.national_shipping_strategy = 'desligado' OR v_store_config.national_benefit_scope = 'todas')
                    AND v_store_config.national_discount_type IS NULL
                ) THEN
                    RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                        USING DETAIL = 'Cotação sem carimbo nacional (edge anterior a esta migration) e a configuração atual não é mais o espelho legado do free_shipping_min.';
                END IF;
                -- Espelho confirmado: aplica a MESMA sentinela legada que hoje
                -- decide frete grátis nacional -- se bate, ZERA o price do
                -- cache (a única situação em que este ramo ainda zera o
                -- preço); senão mantém v_shipping_validated como o `price`
                -- já lido. O espelho legado nunca é desconto_na_mais_barata
                -- (a cópia da 20261171000000 nunca produz essa estratégia),
                -- então não há subtotal de desconto a proteger aqui -- só a
                -- sentinela de grátis, que já lê v_calculated_subtotal AO
                -- VIVO (não depende de nada cacheado).
                IF (v_free_shipping_min < 0 AND v_has_free_shipping_item = true)
                   OR v_free_shipping_min = 0.01
                   OR (v_free_shipping_min > 0 AND v_calculated_subtotal >= v_free_shipping_min)
                THEN
                    v_shipping_validated := 0;
                END IF;

            ELSIF jsonb_typeof(v_estrategia_nacional) <> 'object' THEN
                -- EMENDA (revisão T1): a chave EXISTE no JSON, mas o valor
                -- não é um objeto (ex.: `"estrategiaNacional": null` -- json
                -- null, distinto de chave ausente; ou array/string/número
                -- forjado). Não há espelho que salve isto: a edge escreveu
                -- alguma coisa, e essa coisa não é a estratégia -- recusa
                -- direto, sem consultar o espelho legado.
                RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                    USING DETAIL = format('Carimbo nacional da cotação não é um objeto JSON válido (tipo %s).', jsonb_typeof(v_estrategia_nacional));

            ELSE
                -- Carimbo presente e É um objeto JSON (completo, vazio `{}`,
                -- ou parcial -- faltando algum dos 5 campos): as 5 colunas
                -- do instante da cotação têm de casar com as 5 colunas
                -- ATUAIS -- numérico comparado como numeric (o carimbo é
                -- JSON: '15'::numeric = 15, sem ruído de ponto flutuante),
                -- tipoDesconto por IS NOT DISTINCT FROM (o valor pode ser
                -- NULL nos dois lados, fora de desconto_na_mais_barata).
                --
                -- EMENDA (revisão T1): o COALESCE(...,false) fecha um furo
                -- fail-OPEN apanhado na revisão -- um objeto INCOMPLETO
                -- (`{}` ou faltando um campo) faz qualquer `->>'campo'`
                -- devolver SQL NULL; o AND inteiro vira NULL (lógica de três
                -- valores); e `NOT NULL` também é NULL -- nem true nem
                -- false. Um `IF NOT (...)` sem o COALESCE trata `IF NULL`
                -- como falso e NUNCA dispara o RAISE: o carimbo incompleto
                -- passava como "carimbo bate", sem nenhuma comparação de
                -- verdade ter ocorrido.
                IF NOT COALESCE(
                    (v_estrategia_nacional->>'estrategia') = v_store_config.national_shipping_strategy
                    AND (v_estrategia_nacional->>'minimo')::numeric = v_store_config.national_shipping_min
                    AND (v_estrategia_nacional->>'tipoDesconto') IS NOT DISTINCT FROM v_store_config.national_discount_type
                    AND (v_estrategia_nacional->>'valorDesconto')::numeric = v_store_config.national_discount_value
                    AND (v_estrategia_nacional->>'alcance') = v_store_config.national_benefit_scope,
                    false
                ) THEN
                    RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                        USING DETAIL = format('Carimbo nacional da cotação: %s. Configuração atual: estrategia=%s min=%s tipo=%s valor=%s alcance=%s.',
                            v_estrategia_nacional::text, v_store_config.national_shipping_strategy, v_store_config.national_shipping_min,
                            COALESCE(v_store_config.national_discount_type, 'ausente'), v_store_config.national_discount_value, v_store_config.national_benefit_scope);
                END IF;

                -- EMENDA (revisão T1): as 5 colunas batendo não basta para
                -- acima_de_valor/desconto_na_mais_barata com mínimo > 0 --
                -- o `price` cacheado foi calculado em cima do SUBTOTAL de
                -- QUANDO A EDGE COTOU. Se o carrinho mudou depois (item
                -- removido, quantidade reduzida ou aumentada) e o subtotal
                -- ATUAL cruzou o mínimo para o outro lado, o `price`
                -- cacheado promete um grátis/desconto que o subtotal de
                -- agora não sustenta mais (ou nega um benefício que agora
                -- vale). subtotalCotacao ausente (edge sem esta migration,
                -- ou carimbo forjado com o campo omitido) é tratado como
                -- divergente -- falha fechada. Mínimo 0 nunca muda de lado
                -- (subtotal >= 0 é sempre verdadeiro), por isso fica de
                -- fora da checagem.
                IF v_store_config.national_shipping_strategy IN ('acima_de_valor', 'desconto_na_mais_barata')
                   AND v_store_config.national_shipping_min > 0
                   AND (
                       v_subtotal_cotacao IS NULL
                       OR (v_calculated_subtotal >= v_store_config.national_shipping_min)
                          IS DISTINCT FROM (v_subtotal_cotacao >= v_store_config.national_shipping_min)
                   )
                THEN
                    RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                        USING DETAIL = format('Subtotal da cotação: %s. Subtotal atual: %s. Mínimo: %s.',
                            COALESCE(v_subtotal_cotacao::text, 'ausente'), v_calculated_subtotal, v_store_config.national_shipping_min);
                END IF;
                -- carimbo bate e o subtotal continua do mesmo lado do
                -- mínimo: v_shipping_validated (o `price` do cache) fica
                -- como está.
            END IF;
        END IF;

    ELSE
        -- FRETE V2 EMENDA (03/09): id não reconhecido — não é entrega local,
        -- não é cotação de transportadora, e sem CEP não há onde reconciliar.
        -- Antes caía em COALESCE(shipping_fee, 0): preço inventado ou zero.
        -- Falha fechada, como o resto do caminho do dinheiro.
        RAISE EXCEPTION 'Opção de entrega não reconhecida. Volte ao carrinho, calcule o frete e finalize de novo.'
            USING DETAIL = format('O id %s não é entrega local nem cotação gravada, e não há CEP de cotação para reconciliar.', p_shipping_option_id);
    END IF;

    -- 5. Coupon Validation
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT id, value, type INTO v_coupon_id, v_coupon_val, v_coupon_type
        FROM public.coupons
        WHERE UPPER(code) = UPPER(p_coupon_code)
          AND active = true
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit)
          AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)
          FOR UPDATE;

        IF v_coupon_id IS NULL THEN
            -- Achado 16 do laudo (29/08): o WHERE acima junta TODAS as
            -- condições (ativa, validade, limite, mínimo) e um único RAISE
            -- respondia por todas: o cliente recusado por mínimo de carrinho
            -- lia "inválido ou expirado" e nunca soube o motivo. Descobre o
            -- PORQUÊ real e diz; a frase antiga fica só para a corrida
            -- residual (cupom mudou entre as duas consultas).
            SELECT active, valid_until, usage_limit, usage_count, min_purchase
            INTO v_cupom_recusado
            FROM public.coupons
            WHERE UPPER(code) = UPPER(p_coupon_code)
            FOR SHARE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'O cupom % não existe. Confira o código.', p_coupon_code;
            ELSIF NOT v_cupom_recusado.active THEN
                RAISE EXCEPTION 'O cupom % está desativado pela loja.', p_coupon_code;
            ELSIF v_cupom_recusado.valid_until IS NOT NULL AND v_cupom_recusado.valid_until <= now() THEN
                RAISE EXCEPTION 'O cupom % expirou em %.', p_coupon_code, to_char(v_cupom_recusado.valid_until, 'DD/MM/YYYY HH24:MI');
            ELSIF v_cupom_recusado.usage_limit IS NOT NULL AND v_cupom_recusado.usage_limit > 0 AND v_cupom_recusado.usage_count >= v_cupom_recusado.usage_limit THEN
                RAISE EXCEPTION 'O cupom % já atingiu o limite de usos.', p_coupon_code;
            ELSIF v_cupom_recusado.min_purchase IS NOT NULL AND v_cupom_recusado.min_purchase > v_calculated_subtotal THEN
                RAISE EXCEPTION 'O cupom % exige uma compra mínima de R$ %.', p_coupon_code, translate(to_char(v_cupom_recusado.min_purchase, 'FM999999999990.00'), '.', ',');
            ELSE
                RAISE EXCEPTION 'Cupom % inválido ou expirado.', p_coupon_code;
            END IF;
        END IF;

        IF v_coupon_type = 'percentage' THEN
            v_discount_amount := (v_calculated_subtotal * v_coupon_val) / 100;
        ELSE
            v_discount_amount := v_coupon_val;
        END IF;

        IF v_discount_amount > v_calculated_subtotal THEN
            v_discount_amount := v_calculated_subtotal;
        END IF;
    END IF;

    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Price Tampering Protection
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Os valores do pedido mudaram. Atualize o carrinho e tente novamente.'
            USING DETAIL = format(
                'Divergência de total. Calculado: %s (subtotal %s + frete %s - desconto %s), Fornecido: %s. Autenticado: %s. Opção de frete: %s.',
                v_calculated_total, v_calculated_subtotal, v_shipping_validated,
                v_discount_amount, p_total_amount, (v_user_id IS NOT NULL),
                COALESCE(p_shipping_option_id, 'padrão')
            );
    END IF;

    -- 7. Create Order Header
    BEGIN
        INSERT INTO public.marketplace_orders (
        user_id, total, shipping, payment_method, address_id,
        coupon_id, status, notes, customer_name, customer_data,
        subtotal, discount, coupon_code,
        idempotency_key
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id,
        v_coupon_id, 'pending', p_observation, p_customer_name,
        jsonb_build_object(
            'whatsapp', p_customer_phone,
            'address_id', p_address_id,
            'address', p_address_data,
            'shipping_option_id', p_shipping_option_id,
            'destination_cep', v_dest_cep
        )
        -- RETIRADA NA LOJA (20261169000000): o RETRATO do endereço físico
        -- da loja no instante da compra — o pedido não muda se a loja
        -- mudar de endereço depois (mesma régua do snapshot do endereço
        -- da cliente). O 2-ter já provou que ele não está vazio.
        || CASE WHEN p_shipping_option_id = 'store-pickup'
                THEN jsonb_build_object('pickup_address', btrim(v_store_config.store_address))
                ELSE '{}'::jsonb END,
        v_calculated_subtotal, v_discount_amount, p_coupon_code,
        p_idempotency_key
    ) RETURNING id INTO v_order_id;

    EXCEPTION
        WHEN unique_violation THEN
            -- A corrida PERDEU: a requisição gêmea com a MESMA chave
            -- commitou primeiro. Devolvo o pedido dela. Se a chave casar
            -- sem dono legítimo (compartilhamento de sessão entre contas),
            -- falho fechado: nenhum pedido nasce daqui.
            SELECT id INTO v_order_id
              FROM public.marketplace_orders
             WHERE idempotency_key = p_idempotency_key
               AND (v_user_id IS NULL OR user_id IS NOT DISTINCT FROM v_user_id);
            IF v_order_id IS NULL THEN
                RAISE EXCEPTION 'Não foi possível criar o pedido. Atualize a página e tente de novo.';
            END IF;
            RETURN v_order_id;
    END;

    -- 8. Atomic Inventory Update and Order Items Insertion
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock_increment = stock_increment - v_quantity
            WHERE id = v_variant_id AND stock_increment >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT p.nome INTO v_item_name FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT COALESCE(v.price_override, p.preco_venda), p.nome
            INTO v_db_price, v_item_name
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id;
        ELSE
            UPDATE public.produtos
            SET estoque = estoque - v_quantity
            WHERE id = v_product_id AND estoque >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT nome INTO v_item_name FROM public.produtos WHERE id = v_product_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT preco_venda, nome INTO v_db_price, v_item_name FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price, product_name
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name
        );
    END LOOP;

    -- 9. Coupon Usage Update
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_marketplace_order_v24(p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_variant_id uuid;
    v_quantity integer;
    v_item_name text;
    v_rows_affected integer;

    v_db_price numeric;
    v_db_stock integer;
    v_calculated_subtotal numeric := 0;
    v_calculated_total numeric := 0;
    v_discount_amount numeric := 0;
    v_coupon_id uuid;

    v_store_config RECORD;
    v_shipping_validated numeric;
    v_frete_gratis boolean;
    v_has_free_shipping_item boolean := false;
    v_free_shipping_min numeric;
    v_dest_cep text;

    -- R3-3 (20261170000000): a revisão das credenciais de frete carimbada
    -- na opção de cache no instante da cotação (v_revisao_credenciais), e a
    -- revisão ATUAL da loja (v_revisao_atual, lida de
    -- store_shipping_credentials provider='_revisao' logo abaixo, dentro do
    -- ramo de cotação de transportadora). As duas ficam NULL fora desse
    -- ramo -- local-delivery e store-pickup não usam cache de cotação.
    v_revisao_credenciais text;
    v_revisao_atual text;

    -- T1 (20261171000000, estratégias de frete local e nacional): o
    -- carimbo estrategiaNacional da opção de cache (v_estrategia_nacional,
    -- lido na MESMA linha de v_revisao_credenciais) e a estratégia
    -- "espelho" que a cópia legada teria produzido a partir do
    -- free_shipping_min ATUAL (v_espelho_strategy, calculada uma única vez
    -- logo no início do bloco 4) -- usadas só no ramo de cotação de
    -- transportadora, para aceitar cotação sem carimbo (edge anterior a
    -- esta migration) apenas enquanto a configuração nacional ainda é o
    -- espelho legado.
    v_estrategia_nacional jsonb;
    v_espelho_strategy text;
    -- EMENDA (revisão T1, 23/09): o subtotal (preços do BANCO) com que a
    -- edge aplicou a estratégia no instante da cotação, lido da MESMA linha
    -- do cache -- usado só para pegar carrinho que mudou de lado do mínimo
    -- (acima_de_valor/desconto_na_mais_barata) DEPOIS de cotado.
    v_subtotal_cotacao numeric;

    v_coupon_type text;
    v_cupom_recusado RECORD;
    v_coupon_val numeric;

    -- O PORTÃO DE ENTREGA (20261039000000): onde se cotou × onde se entrega.
    v_cep_de_cotacao text;
    v_cep_de_entrega text;

    -- 2-ter (20261168000000, revisão B4): o id da opção de entrega
    -- NORMALIZADO uma única vez — NULLIF(btrim(...)) — lido por TODAS as
    -- comparações do bloco 2-ter (NULL, flat-fee, local-delivery). O
    -- bloco 4 segue lendo o parâmetro cru, VERBATIM (fora do escopo).
    v_opcao text := NULLIF(btrim(p_shipping_option_id), '');
BEGIN

    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO (laudo caça-bugs do molde, 31/08/2026, A1):
    -- a rede pode cair DEPOIS do commit deste pedido. A retentativa honesta
    -- (mesmo clique repetido, F5, mesmo navegador) REPETE a chave da compra
    -- e tem de receber o pedido que JÁ NASCEU — não criar um gêmeo com
    -- estoque e cupom debitados em dobro. Convidado não tem user_id para
    -- amarrar: a chave uuid aleatória É o segredo da compra. Quem está
    -- logado só recupera pedido próprio.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_order_id
          FROM public.marketplace_orders
         WHERE idempotency_key = p_idempotency_key
           AND (v_user_id IS NULL OR user_id IS NOT DISTINCT FROM v_user_id);
        IF v_order_id IS NOT NULL THEN
            RETURN v_order_id;
        END IF;
    END IF;

    -- 1. Address Ownership Check (Only if user is logged in)
    IF p_address_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
        END IF;
    END IF;

    -- 2. Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- 2-bis. O PORTÃO DE ENTREGA MORA AQUI (laudo caça-bugs do molde,
    -- 31/08/2026, A2 + item E). Até hoje a regra do convidado (só entrega
    -- local, decisão do Gabriel de 30/08) e a cobertura da loja
    -- (store_config.shipping_coverage) existiam SÓ na tela: chamando esta
    -- RPC direto, QUALQUER CEP passava — e o caminho flat-fee-* nem olhava
    -- CEP. O comentário do cep-local.ts ("a decisão final é do servidor")
    -- era aspiração; a partir daqui é verdade.
    --
    -- CEP DE ENTREGA verdadeiro, na ordem de confiança: o CEP digitado do
    -- convidado (address_data.cep — é para ONDE a mercadoria vai), o CEP do
    -- endereço do logado (linha própria, dono provado no passo 1), e só por
    -- último o CEP da cotação. O CEP DE COTAÇÃO é o que o frete cobrado
    -- promete — os dois sendo iguais é o que a reconciliação cobra.
    v_cep_de_cotacao := NULLIF(regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g'), '');
    v_cep_de_entrega := NULLIF(regexp_replace(COALESCE(p_address_data->>'cep', ''), '\D', '', 'g'), '');
    IF v_cep_de_entrega IS NULL AND v_user_id IS NOT NULL AND p_address_id IS NOT NULL THEN
        SELECT NULLIF(regexp_replace(cep, '\D', '', 'g'), '') INTO v_cep_de_entrega
          FROM public.user_addresses
         WHERE id = p_address_id AND user_id = v_user_id;
    END IF;
    IF v_cep_de_entrega IS NULL THEN
        v_cep_de_entrega := v_cep_de_cotacao;
    END IF;

    -- RECONCILIAÇÃO (item E do laudo): frete cotado para A não pode cobrar
    -- entrega em B. Cotação AUSENTE não contradiz destino nenhum — frete
    -- grátis e taxa fixa sem passagem pela calculadora chegam aqui sem ela,
    -- e o portão de baixo é quem policia esses caminhos.
    IF v_cep_de_cotacao IS NOT NULL AND v_cep_de_entrega IS NOT NULL
       AND v_cep_de_cotacao <> v_cep_de_entrega THEN
        RAISE EXCEPTION 'O frete foi cotado para outro CEP. Volte ao carrinho, calcule o frete para o CEP de entrega e finalize de novo.'
            USING DETAIL = format('Cotação para o CEP %s, entrega para o CEP %s.', v_cep_de_cotacao, v_cep_de_entrega);
    END IF;

    -- CONVIDADO SÓ ENTREGA LOCAL (decisão do Gabriel, 30/08/2026): fora da
    -- área local exige conta — sem cadastro não existe rastreio honesto do
    -- pedido. Sem origem configurada, o aviso é o certo: a loja ainda nem
    -- consegue cotar entrega (B1 do laudo).
    IF v_user_id IS NULL THEN
        IF v_cep_de_entrega IS NULL THEN
            RAISE EXCEPTION 'Informe o CEP de entrega.'
                USING DETAIL = 'Pedido de convidado sem CEP de entrega nenhum.';
        END IF;
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Convidado exige entrega local, mas a loja não tem CEP de origem.';
        END IF;
        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
            RAISE EXCEPTION 'Compra sem conta é só com entrega na cidade da loja. Entre na sua conta para receber em outro endereço.'
                USING DETAIL = format('CEP %s fora da faixa local (origem %s).', v_cep_de_entrega, v_store_config.origin_cep);
        END IF;
    END IF;

    -- COBERTURA LOCAL (shipping_coverage = 'local') VALE PARA TODOS: loja
    -- que só entrega na cidade não aceita pedido para fora — nem de cliente
    -- logado, nem de frete grátis passando por cima do portão. Com entrega
    -- desconhecida (nem endereço, nem cotação), falha fechada.
    IF v_store_config.shipping_coverage = 'local' THEN
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Cobertura local exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL THEN
            RAISE EXCEPTION 'Informe o CEP de entrega.'
                USING DETAIL = 'Pedido com cobertura local e sem CEP de entrega nenhum.';
        END IF;
        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
            RAISE EXCEPTION 'Esta loja só faz entrega na cidade dela. Confira o CEP de entrega.'
                USING DETAIL = format('CEP %s fora da faixa local com cobertura local.', v_cep_de_entrega);
        END IF;
    END IF;

    -- 2-ter. A MODALIDADE DO FRETE MANDA NO MEIO DE PAGAMENTO (regra do
    -- dono, 21/09/2026): envio por TRANSPORTADORA — qualquer id que não
    -- seja "local-delivery" (melhor-envio-*, frenet-*, o gratuito externo
    -- "free-shipping-promo" que a edge calculate-shipping devolve no
    -- caminho de transportadora; INDEPENDENTE DO PREÇO) — exige pagamento
    -- ANTECIPADO. Tudo aqui é provado ANTES do ramo do frete grátis do
    -- bloco 4: o preset gratuito zera o preço SEM validar o id da opção,
    -- e era por esse buraco que um 'local-delivery' forjado (ou um pedido
    -- de transportadora "na entrega", ou um pedido de fora da cidade SEM
    -- escolha nenhuma) nascia com frete R$ 0.
    -- SEM ESCOLHA (EMENDA desta migration): opção ausente NÃO nasce, em
    -- QUALQUER CEP — com ou sem frete grátis, o preset gratuito do bloco 4
    -- não substitui a escolha. Mesma frase do ELSIF do bloco 4: o
    -- classificador do front (src/lib/recusaDoPedido.ts) casa por ela —
    -- leva de volta ao carrinho, onde a calculadora está.
    -- NORMALIZAÇÃO (revisão B4 do parecer): TODAS as comparações daqui
    -- leem v_opcao (o id com btrim/NULLIF aplicados UMA vez, no DECLARE) —
    -- ' local-delivery' e ' flat-fee-1' (espaços de sobra) caem na regra
    -- CERTA. 'LOCAL-DELIVERY' em maiúsculas NÃO casa 'local-delivery' e
    -- cai no ramo transportadora: fail-closed (recusa em vez de aceitar),
    -- aceitável e documentado. O bloco 4 abaixo continua VERBATIM lendo o
    -- parâmetro cru — fora do escopo desta migration.
    IF v_opcao IS NULL THEN
        RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'
            USING DETAIL = 'Pedido sem opção de entrega: o servidor não inventa frete nem cobra taxa da loja.';
    ELSIF v_opcao LIKE 'flat-fee-%' THEN
        -- Mesma frase do ELSIF antigo do bloco 4, agora provada ANTES do
        -- gratuito: taxa fixa não existe mais (payload velho ou forjado).
        RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
            USING DETAIL = format('O id %s é de taxa fixa, que não existe mais; o servidor não cobra shipping_fee da loja.', v_opcao);
    ELSIF v_opcao = 'local-delivery' THEN
        -- Localidade com o CEP DE ENTREGA verificado no servidor
        -- (v_cep_de_entrega: endereço de dono provado no passo 1, o
        -- CEP digitado do convidado, ou a cotação como último recurso)
        -- contra origin_cep/local_cep_range da store_config — o mesmo
        -- public.is_local_cep do ELSIF do bloco 4 (que continua lá),
        -- só que ANTES do gratuito. FAIL-CLOSED nas duas pontas (revisão
        -- A1 do parecer): origem AUSENTE é recusada ANTES do teste — o
        -- SELECT INTO do passo 2 não reclama linha ausente. CONTRATO FONTE
        -- da is_local_cep (baseline
        -- 20260806000000_baseline_do_schema_vivo.sql:3128): IMMUTABLE e
        -- NÃO STRICT — origem/destino vazio devolve FALSE (nunca NULL) e
        -- faixa NULL é SEMÂNTICA VÁLIDA (compara os 5 primeiros dígitos de
        -- origem e destino; NÃO há, nem deve haver, bloqueio de faixa
        -- NULL). Aqui o predicado é a forma fail-closed —
        -- COALESCE(..., false) = false — defesa em profundidade: se a
        -- função um dia virar STRICT ou devolver NULL, NULL vira false,
        -- que RECUSA em vez de passar.
        -- A frase da origem ausente é a MESMA JÁ CLASSIFICADA do 2-bis
        -- (entrar_na_conta no front). O 2-bis pré-existente acima não foi
        -- expandido (gate de verificação separado, fora do escopo).
        -- Sem CEP de entrega nenhum: falha fechada. Mesma frase do ELSIF:
        -- o classificador do front (src/lib/recusaDoPedido.ts) casa por
        -- ela. O DETAIL faz local_cep_range::text EXPLÍCITO (revisão A2):
        -- sem o cast, coluna numérica faria o '' da COALESCE resolver
        -- para numeric e o erro de cast só apareceria NO DIA da recusa.
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Entrega local exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL
           OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false THEN
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('id local-delivery com CEP de entrega %s fora da área local (origem %s, faixa %s) — provado antes do ramo do frete grátis.',
                    COALESCE(v_cep_de_entrega, 'ausente'), COALESCE(v_store_config.origin_cep, ''), COALESCE(v_store_config.local_cep_range::text, ''));
        END IF;
    ELSIF v_opcao = 'store-pickup' THEN
        -- RETIRADA NA LOJA (20261169000000): a cliente busca o pedido no
        -- endereço físico da loja — frete ZERO, e o pagamento segue as
        -- MESMAS regras da entrega local (é modalidade da própria loja,
        -- não de transportadora: nenhuma restrição de meio aqui, igual ao
        -- ramo local-delivery acima). O servidor REVALIDA, fail-closed, os
        -- requisitos que a edge calculate-shipping usa para OFERECER a
        -- opção — a oferta da edge é conveniência, a regra mora aqui:
        --   1. id CANÔNICO: o bloco 4 e o customer_data leem o parâmetro
        --      CRU; ' store-pickup' (espaço de sobra) validaria aqui pelo
        --      v_opcao e nasceria sem o retrato do endereço — recusado.
        --   2. a loja HABILITOU a retirada: a chave 'store-pickup' em
        --      enabled_shipping_methods. NULL/vazio = desligada. O
        --      COALESCE(... = ANY(...), false) é a forma fail-closed: um
        --      elemento NULL no array faz o = ANY devolver NULL quando a
        --      chave não está lá, e NULL não pode passar por "habilitada".
        --   3. a loja tem ENDEREÇO FÍSICO (store_address com btrim não
        --      vazio, coluna da 20261167000000) — é ele que vai para o
        --      pedido como pickup_address.
        --   4. o CEP de entrega é LOCAL (a MESMA prova do local-delivery,
        --      com as mesmas frases já classificadas pelo front): a
        --      retirada é oferta para quem é da área da loja.
        IF p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = format('id de retirada fora da forma canônica: %s.', p_shipping_option_id);
        END IF;
        IF COALESCE('store-pickup' = ANY(COALESCE(v_store_config.enabled_shipping_methods, '{}'::text[])), false) = false THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = 'A loja não habilitou a retirada na loja (chave store-pickup ausente de enabled_shipping_methods).';
        END IF;
        IF NULLIF(btrim(COALESCE(v_store_config.store_address, '')), '') IS NULL THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = 'Retirada na loja exige o endereço físico da loja (store_address) preenchido.';
        END IF;
        IF COALESCE(v_store_config.origin_cep, '') = '' THEN
            RAISE EXCEPTION 'A loja ainda está configurando a entrega. Fale com a loja.'
                USING DETAIL = 'Retirada na loja exige CEP de origem configurado.';
        END IF;
        IF v_cep_de_entrega IS NULL
           OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false THEN
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('id store-pickup com CEP de entrega %s fora da área local (origem %s, faixa %s) — a retirada na loja é só para a área local.',
                    COALESCE(v_cep_de_entrega, 'ausente'), COALESCE(v_store_config.origin_cep, ''), COALESCE(v_store_config.local_cep_range::text, ''));
        END IF;
    ELSE
        -- A v24 é a RPC do pagamento ANTECIPADO: transportadora
        -- combina com 'online' (PIX pago no app; pagamento online
        -- exige conta, P6) e com MAIS NINGUÉM — pix/card/cash
        -- prometem dinheiro na porta de um correio de outra cidade.
        IF p_payment_method IS DISTINCT FROM 'online' THEN
            RAISE EXCEPTION 'Envio por transportadora exige pagamento antecipado. Pague com PIX no app para finalizar este envio.'
                USING DETAIL = format('Opção de frete %s com meio de pagamento %s: com transportadora, só online passa.', v_opcao, COALESCE(p_payment_method, 'ausente'));
        END IF;
    END IF;

    -- 3. Validation Loop (Price, Stock Lock, Subtotal Calculation)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_quantity <= 0 THEN RAISE EXCEPTION 'Quantidade inválida para um dos itens.'; END IF;

        IF v_variant_id IS NOT NULL THEN
            SELECT COALESCE(v.price_override, p.preco_venda), v.stock_increment, p.nome, p.frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id AND p.id = v_product_id
              AND v.active = true AND p.ativo = true
            FOR NO KEY UPDATE OF v;
        ELSE
            -- A trava de linha vem PRIMEIRO: o SELECT abaixo ja exige
            -- `ativo = true` e trava a linha com `FOR NO KEY UPDATE`, entao a
            -- guarda que vem depois nao tem janela de corrida contra um
            -- UPDATE concorrente em `produtos.ativo`. Com a guarda ANTES (a
            -- forma anterior, com EXISTS + JOIN em `produtos`), ela e o
            -- SELECT tomavam SNAPSHOTS DIFERENTES sob READ COMMITTED: se a
            -- lojista republicasse o produto e commitasse ENTRE os dois
            -- comandos, a guarda nao disparava (produto estava inativo no
            -- primeiro snapshot) e o SELECT achava o produto ativo no
            -- segundo -- o item era vendido pelo preco/estoque do produto
            -- base mesmo tendo variacao ativa. Nesta ordem nao ha segundo
            -- snapshot: os dois leem a MESMA linha, ja travada.
            SELECT preco_venda, estoque, nome, frete_gratis
            INTO v_db_price, v_db_stock, v_item_name, v_frete_gratis
            FROM public.produtos
            WHERE id = v_product_id AND ativo = true
            FOR NO KEY UPDATE;

            -- 🔴 A GUARDA QUE FALTAVA. Sem ela, `variant_id: null` num produto
            -- QUE TEM variacao caia aqui e era aceito: preco de `preco_venda`
            -- em vez de `price_override`, e baixa no `estoque` agregado em vez
            -- do `stock_increment` da variacao escolhida. O pedido nascia sem
            -- tamanho, a lojista nao tinha o que separar, e o estoque daquele
            -- tamanho nunca descia -- vendendo de novo o que ja acabou.
            --
            -- Ate hoje quem segurava isso eram QUATRO copias de um `if` no
            -- cliente. Cada tela nova reabre o buraco, e nenhuma delas alcanca
            -- quem chama a RPC direto.
            --
            -- `v_db_price IS NOT NULL` e o teste de "produto ativo" -- substitui
            -- o JOIN com `produtos` que a guarda tinha antes de mudar de lugar.
            -- Se o SELECT acima nao achou linha (produto inativo), v_db_price
            -- fica NULL, a guarda nem dispara (curto-circuito do AND), e quem
            -- recusa e o `IF v_db_price IS NULL` logo abaixo, com "Produto %
            -- nao disponivel" -- a mensagem certa para um produto fora da
            -- vitrine, nao "Escolha uma variacao" (instrucao impossivel de
            -- seguir para quem nao pode comprar aquele produto de jeito
            -- nenhum). `v.active = true` sozinho, sem JOIN em `produtos`, e o
            -- mesmo predicado que o ramo de cima usa para ACEITAR uma
            -- variacao -- produto cujas variacoes foram TODAS desativadas
            -- continua vendavel pelo produto base.
            IF v_db_price IS NOT NULL AND EXISTS (
                SELECT 1
                FROM public.product_variants v
                WHERE v.product_id = v_product_id
                  AND v.active = true
            ) THEN
                RAISE EXCEPTION 'Escolha uma variação para o produto %.',
                    COALESCE((SELECT nome FROM public.produtos WHERE id = v_product_id), 'selecionado')
                    USING DETAIL = 'variant_id ausente em produto com variacao ativa; o item foi recusado no servidor.';
            END IF;
        END IF;

        IF v_db_price IS NULL THEN RAISE EXCEPTION 'Produto % não disponível.', COALESCE(v_item_name, 'não encontrado'); END IF;
        IF v_db_stock < v_quantity THEN
            RAISE EXCEPTION 'Estoque insuficiente para o produto % (Disponível: %, Solicitado: %)', v_item_name, v_db_stock, v_quantity;
        END IF;

        v_calculated_subtotal := v_calculated_subtotal + (v_db_price * v_quantity);
        IF v_frete_gratis = true THEN
            v_has_free_shipping_item := true;
        END IF;
    END LOOP;

    -- 4. Shipping Calculation
    -- FRETE V2 (20261081000000) + T1 (20261171000000, estratégias de frete
    -- local e nacional): a regra de frete grátis por SENTINELA
    -- (free_shipping_min) passa a valer SÓ para as duas modalidades da
    -- própria loja -- local-delivery e store-pickup. Cotação de
    -- transportadora (qualquer outro id) NUNCA mais é decidida por
    -- free_shipping_min: ela é sempre a linha do cache, com o carimbo
    -- `estrategiaNacional` conferido contra as 5 colunas nacionais atuais
    -- (ver o ramo `ELSIF p_destination_cep IS NOT NULL` abaixo). A marcação
    -- de item grátis (v_has_free_shipping_item) continua vindo do BANCO —
    -- lida no loop de validação pelo product_id, nunca do payload.
    -- Sentinelas da regra LOCAL (mesmas do front, só para local-delivery e
    -- store-pickup):
    --   < 0    -> por_produto: só item marcado zera o frete
    --   = 0.01 -> sempre: todo pedido é grátis
    --   > 0    -> acima_de_valor: subtotal atinge o limiar (SEM trava de
    --             login — a trava v_user_id IS NOT NULL morreu: convidado
    --             tem o mesmo direito; a entrega dele é local e o portão
    --             de CEP continua nos ELSIFs abaixo)
    --   0/NULL -> desligado: nada é grátis aqui (cai na regra do id)
    v_free_shipping_min := COALESCE(v_store_config.free_shipping_min, 0);

    -- T1: a estratégia que a cópia legada (20261171000000) teria produzido
    -- a partir do free_shipping_min ATUAL -- é o "espelho legado" que a
    -- checagem do carimbo AUSENTE (edge anterior a esta migration) usa mais
    -- abaixo. Mesma sentinela do quadro acima, na mesma ordem: 0.01 antes de
    -- > 0, porque 0.01 também é > 0.
    v_espelho_strategy := CASE
        WHEN v_free_shipping_min = 0.01 THEN 'sempre'
        WHEN v_free_shipping_min < 0 THEN 'por_produto'
        WHEN v_free_shipping_min > 0 THEN 'acima_de_valor'
        ELSE 'desligado'
    END;

    IF p_shipping_option_id IS NULL OR p_shipping_option_id = '' THEN
        RAISE EXCEPTION 'Escolha uma opção de entrega antes de finalizar o pedido.'
            USING DETAIL = 'Pedido sem opção de entrega: o servidor não inventa frete nem cobra taxa da loja.';

    -- FRETE V2 EMENDA (03/09): o id `flat-fee-%` deixou de ser escolha válida
    -- — a taxa fixa morreu na edge (calculate-shipping) e aqui no servidor.
    -- Recebê-lo é payload velho ou forjado: falha fechada, NUNCA o
    -- shipping_fee da loja.
    ELSIF p_shipping_option_id LIKE 'flat-fee-%' THEN
        RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
            USING DETAIL = format('O id %s é de taxa fixa, que não existe mais; o servidor não cobra shipping_fee da loja.', p_shipping_option_id);

    -- T1: a regra LOCAL (sentinelas de free_shipping_min) mora só aqui e no
    -- ramo store-pickup abaixo -- id de transportadora nunca mais passa por
    -- ela. A validade do CEP local já foi provada no 2-ter, ANTES deste
    -- bloco; aqui só decide o VALOR: grátis pela sentinela, senão a taxa
    -- configurada (COALESCE(local_delivery_fee, 0), como sempre).
    ELSIF p_shipping_option_id = 'local-delivery' THEN
        v_dest_cep := regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g');
        IF public.is_local_cep(v_store_config.origin_cep, v_dest_cep, v_store_config.local_cep_range) THEN
            IF (v_free_shipping_min < 0 AND v_has_free_shipping_item = true)
               OR v_free_shipping_min = 0.01
               OR (v_free_shipping_min > 0 AND v_calculated_subtotal >= v_free_shipping_min)
            THEN
                v_shipping_validated := 0;
            ELSE
                v_shipping_validated := COALESCE(v_store_config.local_delivery_fee, 0);
            END IF;
        ELSE
            RAISE EXCEPTION 'Entrega local não disponível para o CEP informado.'
                USING DETAIL = format('CEP %s fora da faixa local configurada.', v_dest_cep);
        END IF;

    -- RETIRADA NA LOJA (20261169000000): frete ZERO, sempre -- T1 não muda
    -- este ramo, já era grátis. Os requisitos (id canônico, retirada
    -- habilitada, endereço físico, CEP local) já foram provados no 2-ter,
    -- ANTES do ramo do frete grátis. O CEP de destino é gravado como no
    -- local-delivery (é o CEP da cliente que provou a área). Fica ANTES do
    -- ramo do cache: 'store-pickup' nunca é cotação gravada.
    ELSIF p_shipping_option_id = 'store-pickup' THEN
        v_dest_cep := regexp_replace(COALESCE(p_destination_cep, ''), '\D', '', 'g');
        v_shipping_validated := 0;

    ELSIF p_destination_cep IS NOT NULL THEN
        v_dest_cep := regexp_replace(p_destination_cep, '\D', '', 'g');

        -- T1, passo 1 do contrato "Regra na RPC": nacional exige CEP de
        -- entrega CONHECIDO e NÃO local -- transportadora não atende a
        -- própria cidade da loja (quem mora lá usa local-delivery ou
        -- store-pickup). CEP vazio (garbage no payload) e CEP local caem na
        -- MESMA frase: o cliente volta ao carrinho e escolhe de novo, sem
        -- distinguir o motivo (defesa em profundidade, como o resto do
        -- caminho do dinheiro).
        IF v_dest_cep = '' OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_dest_cep, v_store_config.local_cep_range), false) THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = format('id nacional %s exige CEP de entrega conhecido e fora da área local; CEP recebido: %s.', p_shipping_option_id, COALESCE(NULLIF(v_dest_cep, ''), 'ausente'));
        END IF;

        -- T1: com endereço DE CONTA (p_address_id, dono já provado no passo
        -- 1) e o payload também mandando um CEP em p_address_data, os dois
        -- têm de ser o MESMO endereço -- sem isto, um p_address_data.cep
        -- forjado (diferente do que está salvo) escapava da reconciliação
        -- do 2-bis (que só compara cotação × entrega, e prioriza
        -- p_address_data.cep sobre o CEP salvo quando os dois vêm). Mesma
        -- frase da reconciliação do 2-bis.
        IF p_address_id IS NOT NULL AND v_user_id IS NOT NULL
           AND NULLIF(btrim(COALESCE(p_address_data->>'cep', '')), '') IS NOT NULL
           AND EXISTS (
               SELECT 1 FROM public.user_addresses
                WHERE id = p_address_id AND user_id = v_user_id
                  AND regexp_replace(cep, '\D', '', 'g') <> regexp_replace(p_address_data->>'cep', '\D', '', 'g')
           )
        THEN
            RAISE EXCEPTION 'O frete foi cotado para outro CEP. Volte ao carrinho, calcule o frete para o CEP de entrega e finalize de novo.'
                USING DETAIL = format('O endereço %s tem CEP salvo diferente do CEP enviado no pedido.', p_address_id);
        END IF;

        -- T1, passo 2 do contrato: o atalho por produto NUNCA passa pelo
        -- cache -- ele só existe quando a estratégia nacional vigente é
        -- por_produto e algum item do carrinho está marcado (o mesmo
        -- v_has_free_shipping_item do loop de validação, passo 3). Qualquer
        -- outra combinação com este id é payload velho ou forjado: a
        -- estratégia mudou depois da cotação, ou o front nunca devia ter
        -- oferecido esta opção.
        IF p_shipping_option_id = 'free-shipping-promo' THEN
            IF v_store_config.national_shipping_strategy = 'por_produto' AND v_has_free_shipping_item = true THEN
                v_shipping_validated := 0;
            ELSE
                RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                    USING DETAIL = 'free-shipping-promo só é válido com a estratégia nacional por_produto vigente e item marcado no carrinho.';
            END IF;

        ELSE
            -- T1, passo 3 do contrato: demais ids, SEMPRE pela linha do
            -- cache -- nunca mais pulam para a sentinela local. Preço sai
            -- do que o SERVIDOR gravou, nunca do que o cliente enviou.
            SELECT (opt->>'price')::numeric, opt->>'revisaoCredenciais', opt->'estrategiaNacional', (opt->>'subtotalCotacao')::numeric
              INTO v_shipping_validated, v_revisao_credenciais, v_estrategia_nacional, v_subtotal_cotacao
              FROM public.shipping_quotes_cache q,
                   LATERAL jsonb_array_elements(q.options) AS opt
             WHERE regexp_replace(q.destination_cep, '\D', '', 'g') = v_dest_cep
               AND regexp_replace(COALESCE(q.origin_cep, ''), '\D', '', 'g')
                   = regexp_replace(COALESCE(v_store_config.origin_cep, ''), '\D', '', 'g')
               AND q.created_at > now() - interval '24 hours'
               AND opt->>'id' = p_shipping_option_id
               -- 🔴 A COTACAO TEM DE SER DO CARRINHO QUE ESTA SENDO COMPRADO.
               -- Sem esta condicao dava para cotar o frete com um carrinho pequeno,
               -- encher o carrinho e fechar o pedido pagando o frete do pequeno --
               -- a diferenca saindo do bolso da lojista.
               --
               -- Comparo CONJUNTO contra CONJUNTO, nao texto contra texto. O
               -- `cart_hash` e serializado pela edge function em JavaScript
               -- (getCartHash, calculate-shipping/index.ts): ordenacao por
               -- localeCompare, variante vazia como '', quantidade ausente como 1.
               -- Recompor esse texto aqui obrigaria o banco a reproduzir cada um
               -- desses detalhes, e CADA UM e uma chance de recusar pedido HONESTO
               -- no ultimo clique. Desmontando os dois lados em (produto, variante,
               -- quantidade) e ordenando AQUI, a ordem do JavaScript deixa de
               -- importar. (Medido em 22/08/2026: neste banco localeCompare e o
               -- ORDER BY do Postgres CONCORDAM, en_US.UTF-8 -- mas isso e
               -- propriedade da collation, nao do desenho, e este app e um molde
               -- que nasce em bancos novos.)
               --
               -- Usa `=`, nao IS NOT DISTINCT FROM: com entrada estragada o
               -- resultado e NULL, a linha nao casa, e o pedido e RECUSADO. Falha
               -- fechado, como o resto do caminho do dinheiro.
               AND (SELECT array_agg(x ORDER BY x) FROM (
                      SELECT split_part(t, ':', 1) || ':' ||
                             split_part(t, ':', 2) || ':' ||
                             split_part(t, ':', 3) AS x
                        FROM unnest(string_to_array(q.cart_hash, ',')) AS t
                    ) itens_da_cotacao)
                 = (SELECT array_agg(x ORDER BY x) FROM (
                      SELECT COALESCE(i->>'product_id', '') || ':' ||
                             COALESCE(i->>'variant_id', '') || ':' ||
                             COALESCE(i->>'quantity', '1') AS x
                        FROM jsonb_array_elements(p_items) AS i
                    ) itens_do_pedido)
             ORDER BY q.created_at DESC
             LIMIT 1;

            IF v_shipping_validated IS NULL THEN
                RAISE EXCEPTION 'A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.'
                    USING DETAIL = format(
                        'Sem cotação válida nas últimas 24h para cep=%s, opção=%s -- ou a cotação encontrada era de OUTRO carrinho.',
                        v_dest_cep, p_shipping_option_id
                    );
            END IF;

            -- R3-3 (20261170000000, EMENDA R3 do root): apagar o cache (R2-2) só
            -- ESTREITA a janela -- uma cotação em voo pode gravar DEPOIS da
            -- limpeza. A garantia final mora aqui: se a loja já tem uma linha
            -- '_revisao' (upsert atômico de save_credentials/save_active_providers,
            -- R3-1), a revisão que a opção carregou no instante da cotação
            -- (v_revisao_credenciais, gravada pela edge em R3-2) tem de casar com
            -- a revisão ATUAL. Sem a linha '_revisao' (loja em legado, ou banco
            -- antes do primeiro save da edge), esta checagem NEM RODA -- o
            -- comportamento fica IDÊNTICO ao de hoje.
            SELECT credentials->>'revisao' INTO v_revisao_atual
              FROM public.store_shipping_credentials
             WHERE provider = '_revisao';

            IF v_revisao_atual IS NOT NULL
               AND v_revisao_credenciais IS DISTINCT FROM v_revisao_atual THEN
                RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                    USING DETAIL = format('Revisão da cotação: %s. Revisão atual da loja: %s.', COALESCE(v_revisao_credenciais, 'ausente'), v_revisao_atual);
            END IF;

            -- T1, passo 3 (continuação) + EMENDA (revisão T1, 23/09): o
            -- carimbo estrategiaNacional é a segunda trava independente da
            -- '_revisao' acima -- ela cobre credencial/provedor, esta cobre
            -- a ESTRATÉGIA DE PREÇO (frete grátis e desconto nacional).
            -- v_shipping_validated já é o `price` (final, com a estratégia
            -- já aplicada pela edge no instante da cotação); o que falta é
            -- confirmar que a estratégia (e, para acima_de_valor/
            -- desconto_na_mais_barata, o subtotal) não mudou desde então.
            --
            -- Três situações, na ordem certa -- NÃO é só "presente ou
            -- ausente": a CHAVE pode nem existir no JSON (SQL NULL de
            -- verdade, `opt->'estrategiaNacional'` sem a chave -- edge
            -- anterior a esta migration) OU pode existir com um valor que
            -- não é um objeto completo (json null, array, `{}`, ou um
            -- objeto faltando campo -- carimbo forjado ou edge com bug).
            -- Só o primeiro caso tem o espelho legado como saída; os outros
            -- dois recusam direto.
            IF v_estrategia_nacional IS NULL THEN
                -- Carimbo VERDADEIRAMENTE AUSENTE (a chave nem existe no
                -- JSON da opção -- edge anterior a esta migration): aceito
                -- só se a configuração nacional ATUAL ainda é o espelho
                -- legado do free_shipping_min -- o mesmo predicado do
                -- contrato (seção "Espelho legado" do plano). Fora do
                -- espelho, a lojista já mexeu na estratégia nacional e uma
                -- cotação sem carimbo não tem como provar que respeita a
                -- regra nova.
                IF NOT (
                    v_store_config.national_shipping_strategy = v_espelho_strategy
                    AND (v_store_config.national_shipping_strategy <> 'acima_de_valor' OR v_store_config.national_shipping_min = v_free_shipping_min)
                    AND (v_store_config.national_shipping_strategy = 'desligado' OR v_store_config.national_benefit_scope = 'todas')
                    AND v_store_config.national_discount_type IS NULL
                ) THEN
                    RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                        USING DETAIL = 'Cotação sem carimbo nacional (edge anterior a esta migration) e a configuração atual não é mais o espelho legado do free_shipping_min.';
                END IF;
                -- Espelho confirmado: aplica a MESMA sentinela legada que hoje
                -- decide frete grátis nacional -- se bate, ZERA o price do
                -- cache (a única situação em que este ramo ainda zera o
                -- preço); senão mantém v_shipping_validated como o `price`
                -- já lido. O espelho legado nunca é desconto_na_mais_barata
                -- (a cópia da 20261171000000 nunca produz essa estratégia),
                -- então não há subtotal de desconto a proteger aqui -- só a
                -- sentinela de grátis, que já lê v_calculated_subtotal AO
                -- VIVO (não depende de nada cacheado).
                IF (v_free_shipping_min < 0 AND v_has_free_shipping_item = true)
                   OR v_free_shipping_min = 0.01
                   OR (v_free_shipping_min > 0 AND v_calculated_subtotal >= v_free_shipping_min)
                THEN
                    v_shipping_validated := 0;
                END IF;

            ELSIF jsonb_typeof(v_estrategia_nacional) <> 'object' THEN
                -- EMENDA (revisão T1): a chave EXISTE no JSON, mas o valor
                -- não é um objeto (ex.: `"estrategiaNacional": null` -- json
                -- null, distinto de chave ausente; ou array/string/número
                -- forjado). Não há espelho que salve isto: a edge escreveu
                -- alguma coisa, e essa coisa não é a estratégia -- recusa
                -- direto, sem consultar o espelho legado.
                RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                    USING DETAIL = format('Carimbo nacional da cotação não é um objeto JSON válido (tipo %s).', jsonb_typeof(v_estrategia_nacional));

            ELSE
                -- Carimbo presente e É um objeto JSON (completo, vazio `{}`,
                -- ou parcial -- faltando algum dos 5 campos): as 5 colunas
                -- do instante da cotação têm de casar com as 5 colunas
                -- ATUAIS -- numérico comparado como numeric (o carimbo é
                -- JSON: '15'::numeric = 15, sem ruído de ponto flutuante),
                -- tipoDesconto por IS NOT DISTINCT FROM (o valor pode ser
                -- NULL nos dois lados, fora de desconto_na_mais_barata).
                --
                -- EMENDA (revisão T1): o COALESCE(...,false) fecha um furo
                -- fail-OPEN apanhado na revisão -- um objeto INCOMPLETO
                -- (`{}` ou faltando um campo) faz qualquer `->>'campo'`
                -- devolver SQL NULL; o AND inteiro vira NULL (lógica de três
                -- valores); e `NOT NULL` também é NULL -- nem true nem
                -- false. Um `IF NOT (...)` sem o COALESCE trata `IF NULL`
                -- como falso e NUNCA dispara o RAISE: o carimbo incompleto
                -- passava como "carimbo bate", sem nenhuma comparação de
                -- verdade ter ocorrido.
                IF NOT COALESCE(
                    (v_estrategia_nacional->>'estrategia') = v_store_config.national_shipping_strategy
                    AND (v_estrategia_nacional->>'minimo')::numeric = v_store_config.national_shipping_min
                    AND (v_estrategia_nacional->>'tipoDesconto') IS NOT DISTINCT FROM v_store_config.national_discount_type
                    AND (v_estrategia_nacional->>'valorDesconto')::numeric = v_store_config.national_discount_value
                    AND (v_estrategia_nacional->>'alcance') = v_store_config.national_benefit_scope,
                    false
                ) THEN
                    RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                        USING DETAIL = format('Carimbo nacional da cotação: %s. Configuração atual: estrategia=%s min=%s tipo=%s valor=%s alcance=%s.',
                            v_estrategia_nacional::text, v_store_config.national_shipping_strategy, v_store_config.national_shipping_min,
                            COALESCE(v_store_config.national_discount_type, 'ausente'), v_store_config.national_discount_value, v_store_config.national_benefit_scope);
                END IF;

                -- EMENDA (revisão T1): as 5 colunas batendo não basta para
                -- acima_de_valor/desconto_na_mais_barata com mínimo > 0 --
                -- o `price` cacheado foi calculado em cima do SUBTOTAL de
                -- QUANDO A EDGE COTOU. Se o carrinho mudou depois (item
                -- removido, quantidade reduzida ou aumentada) e o subtotal
                -- ATUAL cruzou o mínimo para o outro lado, o `price`
                -- cacheado promete um grátis/desconto que o subtotal de
                -- agora não sustenta mais (ou nega um benefício que agora
                -- vale). subtotalCotacao ausente (edge sem esta migration,
                -- ou carimbo forjado com o campo omitido) é tratado como
                -- divergente -- falha fechada. Mínimo 0 nunca muda de lado
                -- (subtotal >= 0 é sempre verdadeiro), por isso fica de
                -- fora da checagem.
                IF v_store_config.national_shipping_strategy IN ('acima_de_valor', 'desconto_na_mais_barata')
                   AND v_store_config.national_shipping_min > 0
                   AND (
                       v_subtotal_cotacao IS NULL
                       OR (v_calculated_subtotal >= v_store_config.national_shipping_min)
                          IS DISTINCT FROM (v_subtotal_cotacao >= v_store_config.national_shipping_min)
                   )
                THEN
                    RAISE EXCEPTION 'FRETE_COTACAO_DESATUALIZADA: a configuração de frete da loja mudou depois desta cotação. Calcule o frete novamente e refaça o pedido.'
                        USING DETAIL = format('Subtotal da cotação: %s. Subtotal atual: %s. Mínimo: %s.',
                            COALESCE(v_subtotal_cotacao::text, 'ausente'), v_calculated_subtotal, v_store_config.national_shipping_min);
                END IF;
                -- carimbo bate e o subtotal continua do mesmo lado do
                -- mínimo: v_shipping_validated (o `price` do cache) fica
                -- como está.
            END IF;
        END IF;

    ELSE
        -- FRETE V2 EMENDA (03/09): id não reconhecido — não é entrega local,
        -- não é cotação de transportadora, e sem CEP não há onde reconciliar.
        -- Antes caía em COALESCE(shipping_fee, 0): preço inventado ou zero.
        -- Falha fechada, como o resto do caminho do dinheiro.
        RAISE EXCEPTION 'Opção de entrega não reconhecida. Volte ao carrinho, calcule o frete e finalize de novo.'
            USING DETAIL = format('O id %s não é entrega local nem cotação gravada, e não há CEP de cotação para reconciliar.', p_shipping_option_id);
    END IF;

    -- 5. Coupon Validation
    IF p_coupon_code IS NOT NULL AND p_coupon_code != '' THEN
        SELECT id, value, type INTO v_coupon_id, v_coupon_val, v_coupon_type
        FROM public.coupons
        WHERE UPPER(code) = UPPER(p_coupon_code)
          AND active = true
          AND (valid_until IS NULL OR valid_until > now())
          AND (usage_limit IS NULL OR usage_limit <= 0 OR usage_count < usage_limit)
          AND (min_purchase IS NULL OR v_calculated_subtotal >= min_purchase)
          FOR UPDATE;

        IF v_coupon_id IS NULL THEN
            -- Achado 16 do laudo (29/08): o WHERE acima junta TODAS as
            -- condições (ativa, validade, limite, mínimo) e um único RAISE
            -- respondia por todas: o cliente recusado por mínimo de carrinho
            -- lia "inválido ou expirado" e nunca soube o motivo. Descobre o
            -- PORQUÊ real e diz; a frase antiga fica só para a corrida
            -- residual (cupom mudou entre as duas consultas).
            SELECT active, valid_until, usage_limit, usage_count, min_purchase
            INTO v_cupom_recusado
            FROM public.coupons
            WHERE UPPER(code) = UPPER(p_coupon_code)
            FOR SHARE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'O cupom % não existe. Confira o código.', p_coupon_code;
            ELSIF NOT v_cupom_recusado.active THEN
                RAISE EXCEPTION 'O cupom % está desativado pela loja.', p_coupon_code;
            ELSIF v_cupom_recusado.valid_until IS NOT NULL AND v_cupom_recusado.valid_until <= now() THEN
                RAISE EXCEPTION 'O cupom % expirou em %.', p_coupon_code, to_char(v_cupom_recusado.valid_until, 'DD/MM/YYYY HH24:MI');
            ELSIF v_cupom_recusado.usage_limit IS NOT NULL AND v_cupom_recusado.usage_limit > 0 AND v_cupom_recusado.usage_count >= v_cupom_recusado.usage_limit THEN
                RAISE EXCEPTION 'O cupom % já atingiu o limite de usos.', p_coupon_code;
            ELSIF v_cupom_recusado.min_purchase IS NOT NULL AND v_cupom_recusado.min_purchase > v_calculated_subtotal THEN
                RAISE EXCEPTION 'O cupom % exige uma compra mínima de R$ %.', p_coupon_code, translate(to_char(v_cupom_recusado.min_purchase, 'FM999999999990.00'), '.', ',');
            ELSE
                RAISE EXCEPTION 'Cupom % inválido ou expirado.', p_coupon_code;
            END IF;
        END IF;

        IF v_coupon_type = 'percentage' THEN
            v_discount_amount := (v_calculated_subtotal * v_coupon_val) / 100;
        ELSE
            v_discount_amount := v_coupon_val;
        END IF;

        IF v_discount_amount > v_calculated_subtotal THEN
            v_discount_amount := v_calculated_subtotal;
        END IF;
    END IF;

    v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);

    -- 6. Price Tampering Protection
    IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN
        RAISE EXCEPTION 'Os valores do pedido mudaram. Atualize o carrinho e tente novamente.'
            USING DETAIL = format(
                'Divergência de total. Calculado: %s (subtotal %s + frete %s - desconto %s), Fornecido: %s. Autenticado: %s. Opção de frete: %s.',
                v_calculated_total, v_calculated_subtotal, v_shipping_validated,
                v_discount_amount, p_total_amount, (v_user_id IS NOT NULL),
                COALESCE(p_shipping_option_id, 'padrão')
            );
    END IF;

    -- 7. Create Order Header
    BEGIN
        INSERT INTO public.marketplace_orders (
        user_id, total, shipping, payment_method, address_id,
        coupon_id, status, notes, customer_name, customer_data,
        subtotal, discount, coupon_code,
        payment_status, expires_at,
        idempotency_key
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id,
        v_coupon_id, 'pending', p_observation, p_customer_name,
        jsonb_build_object(
            'whatsapp', p_customer_phone,
            'address_id', p_address_id,
            'address', p_address_data,
            'shipping_option_id', p_shipping_option_id,
            'destination_cep', v_dest_cep
        )
        -- RETIRADA NA LOJA (20261169000000): o RETRATO do endereço físico
        -- da loja no instante da compra — o pedido não muda se a loja
        -- mudar de endereço depois (mesma régua do snapshot do endereço
        -- da cliente). O 2-ter já provou que ele não está vazio.
        || CASE WHEN p_shipping_option_id = 'store-pickup'
                THEN jsonb_build_object('pickup_address', btrim(v_store_config.store_address))
                ELSE '{}'::jsonb END,
        v_calculated_subtotal, v_discount_amount, p_coupon_code,
        'aguardando', now() + interval '30 minutes',
        p_idempotency_key
    ) RETURNING id INTO v_order_id;

    EXCEPTION
        WHEN unique_violation THEN
            -- A corrida PERDEU: a requisição gêmea com a MESMA chave
            -- commitou primeiro. Devolvo o pedido dela. Se a chave casar
            -- sem dono legítimo (compartilhamento de sessão entre contas),
            -- falho fechado: nenhum pedido nasce daqui.
            SELECT id INTO v_order_id
              FROM public.marketplace_orders
             WHERE idempotency_key = p_idempotency_key
               AND (v_user_id IS NULL OR user_id IS NOT DISTINCT FROM v_user_id);
            IF v_order_id IS NULL THEN
                RAISE EXCEPTION 'Não foi possível criar o pedido. Atualize a página e tente de novo.';
            END IF;
            RETURN v_order_id;
    END;

    -- 8. Atomic Inventory Update and Order Items Insertion
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_variant_id := (v_item->>'variant_id')::uuid;
        v_quantity := (v_item->>'quantity')::integer;

        IF v_variant_id IS NOT NULL THEN
            UPDATE public.product_variants
            SET stock_increment = stock_increment - v_quantity
            WHERE id = v_variant_id AND stock_increment >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT p.nome INTO v_item_name FROM public.produtos p JOIN public.product_variants v ON v.product_id = p.id WHERE v.id = v_variant_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT COALESCE(v.price_override, p.preco_venda), p.nome
            INTO v_db_price, v_item_name
            FROM public.produtos p
            JOIN public.product_variants v ON v.product_id = p.id
            WHERE v.id = v_variant_id;
        ELSE
            UPDATE public.produtos
            SET estoque = estoque - v_quantity
            WHERE id = v_product_id AND estoque >= v_quantity;

            GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
            IF v_rows_affected = 0 THEN
                SELECT nome INTO v_item_name FROM public.produtos WHERE id = v_product_id;
                RAISE EXCEPTION 'Estoque insuficiente para o produto %', v_item_name;
            END IF;

            SELECT preco_venda, nome INTO v_db_price, v_item_name FROM public.produtos WHERE id = v_product_id;
        END IF;

        INSERT INTO public.marketplace_order_items (
            order_id, product_id, variant_id, quantity, price, product_name
        ) VALUES (
            v_order_id, v_product_id, v_variant_id, v_quantity, v_db_price, v_item_name
        );
    END LOOP;

    -- 9. Coupon Usage Update
    IF v_coupon_id IS NOT NULL THEN
        UPDATE public.coupons SET usage_count = usage_count + 1 WHERE id = v_coupon_id;
    END IF;

    RETURN v_order_id;
END;
$function$;

-- Pós-DDL (defeito apanhado em execução real, 20/09/2026, mesma régua da
-- 20261167000000): DDL aplicado por conexão direta NÃO recarrega o schema
-- cache do PostgREST — sem o NOTIFY abaixo, o `select=*` da REST continua
-- devolvendo store_config e v_store_config SEM as colunas novas. Idempotente:
-- NOTIFY de novo não faz mal.
NOTIFY pgrst, 'reload schema';
