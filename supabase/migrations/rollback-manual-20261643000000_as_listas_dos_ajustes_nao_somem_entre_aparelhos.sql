-- Rollback manual da 20261643000000 (as listas dos ajustes nao somem entre aparelhos).
-- Devolve, byte a byte, o corpo de upsert_store_config da 20261310000000 e o de salvar_politica_de_devolucao da
-- 20261199000000. Mesma assinatura (CREATE OR REPLACE): OID, dono, ACL e atributos ficam, conferidos no fim.
-- Nenhum dado a desfazer: a migration nao gravou linha nenhuma. Depois dele, a chave `vistos` volta a ser ignorada e
-- a gravacao das listas volta a ser por cima (o defeito de antes); o front novo continua funcionando.
-- Pre-voo: recusa se os dois corpos vivos nao forem os que a 20261643000000 deixou (nada a desfazer, ou uma sucessora
-- no ar -- desfaca a sucessora antes).
-- Executar pelo aplicar-migrations.yml: o ledger e removido na mesma transacao.
-- Sem BEGIN/COMMIT: a transacao pertence ao aplicador.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261643000000$
DECLARE
  v_up text;
  v_po text;
BEGIN
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_up
    FROM pg_proc WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)');
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_po
    FROM pg_proc WHERE oid = to_regprocedure('public.salvar_politica_de_devolucao(jsonb)');
  IF v_up IS DISTINCT FROM '2f772ffd1370359ba6c64540b71c35b2' OR v_po IS DISTINCT FROM '976f05a67ca929ace608a62391588bcd' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de upsert_store_config (%) ou de salvar_politica_de_devolucao (%) nao e o que a 20261643000000 deixou -- nada a desfazer, ou uma redefinicao posterior esta no ar; revise antes de reverter.',
      COALESCE(v_up, 'ausente'), COALESCE(v_po, 'ausente');
  END IF;
  PERFORM set_config('ikcous.listas1643_rb_upsert',
    (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure('public.upsert_store_config(jsonb)'))::text, true);
  PERFORM set_config('ikcous.listas1643_rb_politica',
    (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_politica_de_devolucao(jsonb)'))::text, true);
END $preflight_rollback_20261643000000$;

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
    store_legal_name, store_legal_document, store_support_email,
    local_delivery_enabled, local_delivery_days, free_shipping_card_style
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
    config_json->>'store_support_email',
    -- 20261244000000: COM padrão de fábrica (entrega própria ligada, prazo de 1 dia) -- as
    -- duas colunas são NOT NULL com DEFAULT, então o candidato do INSERT nasce com o mesmo
    -- valor do DEFAULT quando a chave não vem (mesma régua de national_shipping_min). No
    -- ON CONFLICT abaixo só vale o que veio no payload.
    COALESCE((config_json->>'local_delivery_enabled')::boolean, true),
    COALESCE((config_json->>'local_delivery_days')::integer, 1),
    COALESCE(config_json->>'free_shipping_card_style', 'completo')
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
    -- 20261244000000: como a loja entrega na cidade ("Entrego" / "Entrego e retiro" / "Só
    -- retiro") e em quantos dias -- o CASE por coluna garante que salvar uma delas (ou
    -- qualquer outro campo da loja) não apaga as demais. O "Só retiro" é validado pela
    -- trigger store_config_so_retirada_exige_retirada sobre a linha FINAL.
    local_delivery_enabled = CASE WHEN config_json ? 'local_delivery_enabled'
      THEN (config_json->>'local_delivery_enabled')::boolean
      ELSE store_config.local_delivery_enabled END,
    local_delivery_days = CASE WHEN config_json ? 'local_delivery_days'
      THEN (config_json->>'local_delivery_days')::integer
      ELSE store_config.local_delivery_days END,
    free_shipping_card_style = CASE WHEN config_json ? 'free_shipping_card_style'
      THEN config_json->>'free_shipping_card_style'
      ELSE store_config.free_shipping_card_style END,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_politica_de_devolucao(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v public.politica_devolucao%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Política inválida.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.politica_devolucao (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

  -- Parcial: campo ausente fica como está. Os CHECKs da tabela recusam prazo
  -- abaixo da lei e método desconhecido.
  UPDATE public.politica_devolucao SET
    prazo_arrependimento_dias = CASE WHEN p ? 'prazo_arrependimento_dias'
      THEN (p ->> 'prazo_arrependimento_dias')::integer ELSE prazo_arrependimento_dias END,
    prazo_troca_dias = CASE WHEN p ? 'prazo_troca_dias'
      THEN (p ->> 'prazo_troca_dias')::integer ELSE prazo_troca_dias END,
    prazo_vicio_dias = CASE WHEN p ? 'prazo_vicio_dias'
      THEN (p ->> 'prazo_vicio_dias')::integer ELSE prazo_vicio_dias END,
    aceita_troca = CASE WHEN p ? 'aceita_troca' THEN (p ->> 'aceita_troca')::boolean ELSE aceita_troca END,
    aceita_vale = CASE WHEN p ? 'aceita_vale' THEN (p ->> 'aceita_vale')::boolean ELSE aceita_vale END,
    exige_fotos_vicio = CASE WHEN p ? 'exige_fotos_vicio'
      THEN (p ->> 'exige_fotos_vicio')::boolean ELSE exige_fotos_vicio END,
    metodos_locais = CASE WHEN p ? 'metodos_locais'
      THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'metodos_locais')) ELSE metodos_locais END,
    metodos_nacionais = CASE WHEN p ? 'metodos_nacionais'
      THEN ARRAY(SELECT jsonb_array_elements_text(p -> 'metodos_nacionais')) ELSE metodos_nacionais END,
    reembolso_momento = CASE WHEN p ? 'reembolso_momento'
      THEN p ->> 'reembolso_momento' ELSE reembolso_momento END,
    frete_troca_pago_por = CASE WHEN p ? 'frete_troca_pago_por'
      THEN p ->> 'frete_troca_pago_por' ELSE frete_troca_pago_por END,
    categorias_sem_troca = CASE WHEN p ? 'categorias_sem_troca'
      THEN ARRAY(SELECT btrim(c) FROM jsonb_array_elements_text(p -> 'categorias_sem_troca') c
                  WHERE btrim(c) <> '') ELSE categorias_sem_troca END,
    texto_politica = CASE WHEN p ? 'texto_politica'
      THEN NULLIF(btrim(COALESCE(p ->> 'texto_politica', '')), '') ELSE texto_politica END,
    endereco_devolucao = CASE WHEN p ? 'endereco_devolucao'
      THEN NULLIF(btrim(COALESCE(p ->> 'endereco_devolucao', '')), '') ELSE endereco_devolucao END,
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = 1
  RETURNING * INTO v;

  RETURN to_jsonb(v) - 'updated_by';
END;
$$;

DO $conferencia_rollback_20261643000000$
BEGIN
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)'))
       IS DISTINCT FROM 'aa4ed730ac6ad3d3c2644b4285ff39a9'
     OR (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.salvar_politica_de_devolucao(jsonb)'))
       IS DISTINCT FROM '043f816330a66b290fd04d272a4ee934' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: rollback da 20261643000000 -- os corpos nao voltaram aos da 20261310000000 e da 20261199000000.';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure('public.upsert_store_config(jsonb)'))
       IS DISTINCT FROM current_setting('ikcous.listas1643_rb_upsert')::jsonb
     OR (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_politica_de_devolucao(jsonb)'))
       IS DISTINCT FROM current_setting('ikcous.listas1643_rb_politica')::jsonb THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: rollback da 20261643000000 -- OID, dono, ACL ou atributo de upsert_store_config ou de salvar_politica_de_devolucao mudou.';
  END IF;
END $conferencia_rollback_20261643000000$;

NOTIFY pgrst, 'reload schema';
