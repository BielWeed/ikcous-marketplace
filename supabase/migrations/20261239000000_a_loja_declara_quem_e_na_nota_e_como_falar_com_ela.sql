-- A LOJA PODE DECLARAR RAZÃO SOCIAL, CNPJ/CPF E E-MAIL DE ATENDIMENTO
-- (decisão do dono e do sócio, 14/10/2026; 100% opcional e ADITIVA)
--
-- O QUE FALTAVA: quem compra numa loja e quer saber QUEM está vendendo (razão
-- social, CNPJ) e por onde falar sem WhatsApp (e-mail) não achava isso em
-- lugar nenhum — os Termos e a Política de Privacidade diziam "a loja" sem
-- nome jurídico, e o app não guardava o dado. Agora a lojista PODE informar
-- os três; quem não preencher não muda NADA para ninguém.
--
-- AS TRÊS COLUNAS NOVAS (todas text NULL, sem DEFAULT — texto da loja não tem
-- valor de fábrica, mesma régua de store_address/store_description):
--   - store_legal_name     razão social (ou nome do titular), 1 a 200 caracteres.
--   - store_legal_document CNPJ ou CPF, SÓ os caracteres (sem máscara):
--                          CPF = 11 dígitos; CNPJ = 12 caracteres [0-9A-Z] +
--                          2 dígitos verificadores (o CNPJ alfanumérico da
--                          Receita vale desde julho/2026; o numérico antigo
--                          cabe na mesma forma). O DÍGITO VERIFICADOR é
--                          conferido no app (src/lib/identidade-legal-da-loja.ts);
--                          o banco só garante a FORMA, para não duplicar a conta
--                          do documento em dois lugares que divergem.
--   - store_support_email  e-mail de atendimento: forma `a@b.c`, até 254.
-- AUSÊNCIA tem UMA representação só: NULL. Texto vazio é RECUSADO pela CHECK
-- (o app manda null quando o campo está em branco).
--
-- SEGURANÇA/EXPOSIÇÃO: os três são PÚBLICOS por desenho — a loja os quer
-- mostrar à cliente (Termos, Privacidade, rodapé). O caminho da leitura
-- pública já existe e não muda: a vitrine lê `v_store_config` (security_invoker)
-- e a tabela store_config tem SELECT público (política store_config_select_policy
-- = true). Medido no banco vivo antes desta migration: nenhuma das 42 colunas
-- da tabela é segredo (as chaves são as PÚBLICAS do Mercado Pago e do push), então
-- nada privado passa a vazar por esta via. A ESCRITA segue só pela
-- upsert_store_config (SECURITY DEFINER, exige admin ATUAL); as políticas de
-- INSERT/UPDATE/DELETE da tabela não mudam. As colunas NÃO entram no WHEN das
-- triggers dominio_publico_* (são do lojista, não da frota) nem no rastreio de
-- revisão da identidade visual (branding_a5_track_revision), e a
-- save_store_identity (identidade revisada) fica intocada.
--
-- DADOS EXISTENTES: a linha id=1 ganha NULL/NULL/NULL (ADD COLUMN sem DEFAULT).
-- Nenhuma linha é lida, comparada nem reescrita por esta migration.
--
-- O QUE MUDA, em ordem:
--   1. preflight (recusa sem gravar nada se o corpo vivo da upsert_store_config
--      ou a lista de colunas da view não forem os esperados);
--   2. as 3 colunas (ADD COLUMN IF NOT EXISTS) e as 3 CHECK de forma;
--   3. v_store_config: as 3 colunas NO FIM (CREATE OR REPLACE VIEW só aceita
--      coluna nova no fim; o ACL e as opções da view ficam como estão);
--   4. upsert_store_config: aceita as 3 chaves com o padrão da casa — INSERT
--      sem COALESCE e ON CONFLICT com CASE WHEN config_json ? 'chave' (só
--      sobrescreve o que veio no payload: salvar a razão social não apaga o
--      horário, o endereço nem nada mais). Resto do corpo BYTE A BYTE o que a
--      20261199000000 deixou;
--   5. pós-voo (recusa e desfaz tudo se algo não ficou como o desenho diz).
--
-- IDEMPOTÊNCIA: ADD COLUMN IF NOT EXISTS, CHECK sob DO IF NOT EXISTS, CREATE OR
-- REPLACE da view e da função. O preflight aceita tanto o corpo que esta
-- migration SUBSTITUI (o da 20261199000000) quanto o que ela mesma DEIXA (a
-- segunda aplicação encontra o próprio resultado).
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- `node scripts/db-apply.cjs` (uma transação por arquivo). Sem BEGIN/COMMIT de
-- nível superior neste arquivo (regra da casa). ROLLBACK:
-- rollback-manual-20261239000000_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela.sql
-- (devolve o corpo da 20261199 e a view de 42 colunas; recusa se alguma loja já
-- preencheu um dos três campos — apagar o que a lojista digitou é ato
-- deliberado, nunca efeito colateral).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação:
--   1. SELECT column_name, data_type, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_schema='public' AND table_name='store_config'
--         AND column_name IN ('store_legal_name','store_legal_document','store_support_email');
--      -- esperado: 3 linhas, text, YES, sem default.
--   2. SELECT store_legal_name, store_legal_document, store_support_email
--        FROM public.v_store_config;
--      -- esperado: 1 linha, NULL/NULL/NULL até a lojista preencher.
--   3. SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc
--       WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)');
--      -- esperado: o hash "desta" do preflight abaixo.

DO $preflight_20261239$
DECLARE
  r record;
  v_hash text;
  v_colunas text;
  v_tipo text;
BEGIN
  -- (1) O corpo vivo da upsert_store_config: o que a 20261199000000 deixou
  --     (vigente) ou o que esta migration deixa (reaplicação). md5 do
  --     prosrc sem CR, a mesma régua da 99 e de tests/banco/sucessoras-da-99.cjs.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.upsert_store_config(jsonb)', '9c56a9c6953e1d774a1ee97d5d8a7e16', 'b562669936df1cda31d4bdd4d075bff3')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
      FROM pg_proc
     WHERE oid = to_regprocedure(r.assinatura);

    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- (2) A lista de colunas da view: as 42 que a 20261174 deixou, ou essas 42 +
  --     as 3 desta migration (reaplicação). Outra lista = alguém mexeu na view
  --     por fora: revise antes de apendar colunas em cima dela.
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_colunas
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.v_store_config')
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_colunas IS NULL OR v_colunas NOT IN (
    'id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega',
    'id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega,store_legal_name,store_legal_document,store_support_email'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a lista de colunas de v_store_config não é a que esta migration supõe (%) — revise antes de aplicar.', COALESCE(v_colunas, 'view ausente');
  END IF;

  -- (3) Se um nome das colunas novas já existe na tabela, tem de ser text:
  --     ADD COLUMN IF NOT EXISTS pularia em silêncio uma coluna de outro tipo.
  FOR r IN
    SELECT unnest(ARRAY['store_legal_name','store_legal_document','store_support_email']) AS coluna
  LOOP
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.store_config')
       AND a.attname = r.coluna AND NOT a.attisdropped;
    IF v_tipo IS NOT NULL AND v_tipo <> 'text' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: store_config.% já existe com o tipo % — esperava text ou ausente.', r.coluna, v_tipo;
    END IF;
  END LOOP;
END $preflight_20261239$;

-- (1) As colunas: ADITIVAS, nulas, sem DEFAULT.
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_legal_name text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_legal_document text;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS store_support_email text;

-- As CHECK garantem só a FORMA e a ausência única (NULL, nunca ''). O dígito
-- verificador do documento é do app.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_store_legal_name_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_store_legal_name_check
      CHECK (store_legal_name IS NULL
        OR char_length(btrim(store_legal_name)) BETWEEN 1 AND 200);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_store_legal_document_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_store_legal_document_check
      CHECK (store_legal_document IS NULL
        OR store_legal_document ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_store_support_email_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_store_support_email_check
      CHECK (store_support_email IS NULL
        OR (char_length(store_support_email) <= 254
          AND store_support_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
  END IF;
END $$;

-- (2) v_store_config: as 42 da 20261174 na MESMA ordem + as 3 novas no FIM.
-- CREATE OR REPLACE (não DROP): acrescentar no fim é o caso que ele aceita, e
-- assim o ACL (anon/authenticated/service_role) e as opções da view não são
-- recriados — nada que lê a view hoje deixa de ler por um instante.
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
    national_benefit_scope,
    formas_pagamento_entrega,
    store_legal_name,
    store_legal_document,
    store_support_email
   FROM store_config
  WHERE id = 1;

-- (3) upsert_store_config: BYTE A BYTE o corpo que a 20261199000000 deixou,
-- com as ÚNICAS três trocas comentadas abaixo (o preflight acima provou o
-- ponto de partida pelo hash do prosrc):
--   (a) lista de colunas do INSERT: + store_legal_name, store_legal_document,
--       store_support_email;
--   (b) VALUES do INSERT: sem COALESCE — ausência grava NULL, nunca inventa;
--   (c) ON CONFLICT: só sobrescreve a coluna que veio no payload.
CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
  v_methods text[];
  v_has_methods boolean;
  -- FORMAS DE PAGAMENTO POR LOJA (25/09/2026): mesmo par v_has_.../v_...
  -- que v_has_methods/v_methods acima, com UMA diferença (revisão B1): a
  -- coluna nasceu com um invariante (trigger
  -- store_config_exige_forma_de_pagamento — cardinality=0 exige
  -- pagamento_online=true), e o candidato do INSERT é avaliado por essa
  -- trigger MESMO quando o destino real é o ON CONFLICT DO UPDATE
  -- (Postgres roda a trigger BEFORE INSERT antes de decidir se colide). Um
  -- array fixo aqui validaria um estado que a loja nunca teve — por isso
  -- v_formas_pagamento, quando a chave não vem no payload, reflete o valor
  -- ATUAL da linha (mesmo truque do logo_url, abaixo), não um array fixo.
  v_has_formas_pagamento boolean;
  v_formas_pagamento text[];
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
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

  -- Mesmo par v_has_.../v_... de cima, com o fallback do B1: quando a
  -- chave não vem no payload, o candidato do INSERT carrega o valor ATUAL
  -- da linha (não um array fixo) — é isso que impede a trigger BEFORE
  -- INSERT de recusar um salvamento não relacionado numa loja que já vende
  -- só pelo app (formas_pagamento_entrega='{}' com pagamento_online=true).
  v_has_formas_pagamento := config_json ? 'formas_pagamento_entrega'
    AND config_json->'formas_pagamento_entrega' IS NOT NULL
    AND jsonb_typeof(config_json->'formas_pagamento_entrega') = 'array';

  IF v_has_formas_pagamento THEN
    SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_formas_pagamento
    FROM jsonb_array_elements_text(config_json->'formas_pagamento_entrega') x;
  ELSE
    SELECT formas_pagamento_entrega INTO v_formas_pagamento
      FROM public.store_config WHERE id = 1;
    v_formas_pagamento := COALESCE(v_formas_pagamento, ARRAY['pix','card','cash']::text[]);
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
    national_discount_type, national_discount_value, national_benefit_scope,
    formas_pagamento_entrega,
    store_legal_name, store_legal_document, store_support_email
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
    COALESCE(config_json->>'national_benefit_scope', 'mais_barata'),
    v_formas_pagamento,
    -- 20261239000000: sem default de fábrica — razão social, documento e
    -- e-mail de atendimento só existem quando a lojista digita.
    config_json->>'store_legal_name',
    config_json->>'store_legal_document',
    config_json->>'store_support_email'
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
    -- FORMAS DE PAGAMENTO POR LOJA (25/09/2026): grava só quando a chave
    -- vem no payload -- preserva o que já estava lá quando não vem (mesmo
    -- CASE das demais colunas parciais).
    formas_pagamento_entrega = CASE WHEN v_has_formas_pagamento
      THEN v_formas_pagamento
      ELSE store_config.formas_pagamento_entrega END,
    -- 20261239000000: razão social, documento e e-mail de atendimento — o
    -- CASE por coluna garante que salvar um deles (ou qualquer outro campo
    -- da loja) não apaga os demais.
    store_legal_name = CASE WHEN config_json ? 'store_legal_name'
      THEN config_json->>'store_legal_name'
      ELSE store_config.store_legal_name END,
    store_legal_document = CASE WHEN config_json ? 'store_legal_document'
      THEN config_json->>'store_legal_document'
      ELSE store_config.store_legal_document END,
    store_support_email = CASE WHEN config_json ? 'store_support_email'
      THEN config_json->>'store_support_email'
      ELSE store_config.store_support_email END,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

-- (4) Pós-voo: o desenho ficou como disse, ou nada fica.
DO $posvoo_20261239$
DECLARE
  v_hash text;
  v_n integer;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)');
  IF v_hash IS DISTINCT FROM 'b562669936df1cda31d4bdd4d075bff3' THEN
    RAISE EXCEPTION 'POSVOO_20261239000000: upsert_store_config não ficou com o corpo desta migration (hash %)', COALESCE(v_hash, 'ausente');
  END IF;

  SELECT count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'store_config'
     AND column_name IN ('store_legal_name','store_legal_document','store_support_email')
     AND data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'POSVOO_20261239000000: esperava 3 colunas text nulas e sem default em store_config, achei %', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint
   WHERE conrelid = 'public.store_config'::regclass
     AND conname IN ('store_config_store_legal_name_check',
                     'store_config_store_legal_document_check',
                     'store_config_store_support_email_check');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'POSVOO_20261239000000: esperava 3 CHECK de forma, achei %', v_n;
  END IF;

  -- A view lê as 3 colunas e quem a lia ANTES continua lendo.
  IF NOT has_table_privilege('anon', 'public.v_store_config', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.v_store_config', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.v_store_config', 'SELECT') THEN
    RAISE EXCEPTION 'POSVOO_20261239000000: v_store_config perdeu o SELECT de anon, authenticated ou service_role';
  END IF;
  PERFORM store_legal_name, store_legal_document, store_support_email
     FROM public.v_store_config;
END $posvoo_20261239$;

-- Pós-DDL: DDL aplicado por conexão direta NÃO recarrega o schema cache do
-- PostgREST — sem o NOTIFY abaixo o `select=*` da REST segue devolvendo
-- store_config e v_store_config SEM as colunas novas (o save pela RPC
-- funcionaria e a leitura não). Idempotente.
NOTIFY pgrst, 'reload schema';
