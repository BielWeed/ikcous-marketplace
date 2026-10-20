-- ============================================================================
-- Migration 20261244000000 — a loja escolhe como entrega na cidade dela e em quantos dias
-- (decisão do dono e do sócio, 16/10/2026; ADITIVA; dinheiro + permissão + contrato)
-- ============================================================================
--
-- 1. O QUE FALTAVA
--
-- A lojista só podia ligar ou desligar a retirada na loja ao lado da entrega própria ("Entrega Local"), e a
-- entrega própria SEMPRE existia, sempre com prazo de 1 dia útil escrito no código. Quem só quer que a cliente
-- venha buscar (ou quem entrega em 3 dias) não tinha como dizer isso. Agora ela responde a UMA pergunta, "Como
-- você entrega na sua cidade?", com três respostas, e informa o prazo da entrega própria:
--
--   "Entrego"            entrega própria ligada, retirada desligada;
--   "Entrego e retiro"   as duas ligadas;
--   "Só retiro"          entrega própria DESLIGADA, retirada ligada, e a retirada vale para QUALQUER CEP
--                        (a cliente busca na loja; o CEP dela só serve para cotar).
--
-- A retirada continua sendo a chave que já existe, 'store-pickup' em enabled_shipping_methods; nenhuma opção de
-- entrega muda de id nem de nome ("local-delivery" segue "Entrega Local"), então o e-mail, a etiqueta, o antifraude,
-- a ficha da lojista e o app antigo continuam entendendo tudo.
--
-- 2. AS DUAS COLUNAS (store_config)
--
--   local_delivery_enabled  boolean NOT NULL DEFAULT true      entrega própria ligada (false = "Só retiro").
--   local_delivery_days     integer NOT NULL DEFAULT 1         prazo da entrega própria, em dias, de 0 a 30
--                           (CHECK store_config_local_delivery_days_check). O 0 existe para "no mesmo dia".
--
-- Os DEFAULTs reproduzem o comportamento de hoje: loja que não mexe em nada entrega na cidade, com 1 dia, sem
-- nenhuma mudança em preço, prazo, recusa ou texto.
--
-- 3. A TRAVA DO "SÓ RETIRO" (trigger store_config_so_retirada_exige_retirada)
--
-- BEFORE INSERT OR UPDATE em store_config. Com local_delivery_enabled = false a linha FINAL precisa ter a retirada
-- ligada ('store-pickup' em enabled_shipping_methods) E o endereço físico da loja (store_address não vazio); senão
-- recusa com LOJA_SO_RETIRADA_SEM_RETIRADA (o DETAIL diz qual dos dois faltou). Sem isso a loja ficaria sem NENHUMA
-- forma de entregar na cidade. Mesma régua da trigger store_config_exige_forma_de_pagamento (20261174000000): o
-- INSERT que só VAI desviar para o ON CONFLICT DO UPDATE da upsert_store_config não é a linha final (o candidato
-- carrega o default de enabled_shipping_methods quando a chave não vem) e é ignorado; a linha de verdade é a que o
-- BEFORE UPDATE vê, sempre. A função da trigger é SECURITY DEFINER, sem EXECUTE para ninguém.
--
-- 4. O QUE MUDA NAS DUAS RPCs DE COMPRA (create_marketplace_order_v23 e create_marketplace_order_v24)
--
-- Recriadas por CREATE OR REPLACE com o corpo VIVO inteiro (v23 = 20261229000000, v24 = 20261236000000, byte a byte)
-- e SÓ estas edições, iguais nas duas, comentadas no próprio corpo:
--   (a) duas variáveis, v_so_retirada (entrega própria desligada) e v_retirada_livre (só retiro E a opção escolhida
--       é exatamente 'store-pickup'), lidas logo depois da configuração da loja;
--   (b) a trava do CONVIDADO ("só entrega na cidade") e a de COBERTURA LOCAL só exigem o CEP local de quem NÃO é
--       retirada livre: `NOT v_retirada_livre AND NOT is_local_cep(...)`;
--   (c) a prova de CEP local do ramo 'store-pickup' (2-ter) idem: em "Só retiro" o CEP só precisa existir;
--   (d) 'local-delivery' com v_so_retirada recusa, ANTES de qualquer outra prova, com a frase que os apps no ar já
--       classificam como "volte ao carrinho e escolha outra entrega" ('Opção de entrega inválida. Volte ao carrinho
--       e escolha uma entrega válida.') e DETAIL 'entrega_propria_desligada'.
-- Nada mais muda: assinatura, retorno, SECURITY DEFINER, search_path, VOLATILE e ACL ficam iguais (CREATE OR
-- REPLACE preserva dono e privilégios; nenhum GRANT nem REVOKE aqui). A retirada em "Só retiro" fica gravada no
-- pedido como sempre (frete zero, retrato do endereço da loja em pickup_address). is_local_cep NÃO é tocada.
--
-- 5. VIEW E UPSERT
--
-- v_store_config ganha as duas colunas NO FIM (45 -> 47; CREATE OR REPLACE VIEW só aceita coluna nova no fim, e assim
-- o ACL e as opções da view não são recriados). upsert_store_config aceita as duas chaves com o padrão da casa: o
-- INSERT leva o default de fábrica (COALESCE) e o ON CONFLICT só sobrescreve o que veio no payload (CASE WHEN
-- config_json ? 'chave'): salvar o prazo não apaga o modo, nem o horário, nem nada mais. Resto do corpo BYTE A BYTE
-- o que a 20261239000000 deixou.
--
-- 6. DADOS EXISTENTES
--
-- A linha id=1 de cada loja ganha true / 1 (ADD COLUMN com DEFAULT constante; o Postgres 11+ não reescreve a
-- tabela). NENHUMA linha é lida, comparada ou reescrita por UPDATE, e nenhum pedido existente é tocado: pedido já
-- criado fica como está (nada revalida), carrinho aberto recota quando o hash da cotação mudar.
--
-- 7. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- Recusa se alguma das TRÊS funções não existir, tiver sobrecarga, tiver corpo vivo (md5 de replace(prosrc, E'\r',
-- '')) que não seja UM de dois conhecidos (o vigente, ou o desta migration, para reaplicar), atributos ou ACL
-- diferentes dos de sempre; se a lista de colunas de v_store_config não for a de 45 (ou a de 47, na reaplicação); se
-- uma das colunas novas já existir com outro tipo; ou se a função da trigger já existir com outro corpo. O corpo é
-- identificado pelo CONTEÚDO: loja com corpo desconhecido recusa aqui, sem escrever nada.
--
-- 8. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- Sem BEGIN/COMMIT de nível superior (regra da casa, AGENTS.md: com eles o ROLLBACK do script de prova viraria
-- no-op e a mudança ficaria gravada): quem abre a transação é o aplicador (`aplicar-migrations.yml` / `db-apply.cjs`,
-- uma transação por arquivo); o pré-voo, o DDL, as três trocas de corpo e o pós-voo caem JUNTOS ou não caem. Rodar de
-- novo reescreve o MESMO texto: ADD COLUMN IF NOT EXISTS, CHECK sob IF NOT EXISTS, CREATE OR REPLACE da view e das
-- funções, a trigger é recriada (DROP IF EXISTS + CREATE). O DDL pega trava de store_config; `SET LOCAL lock_timeout`
-- de 5 s faz a migration DESISTIR (55P03, nada gravado) em vez de enfileirar a vitrine inteira atrás dela: se
-- acontecer, aplicar de novo fora do pico.
--
-- 9. ORDEM DE PUBLICAÇÃO (por loja)
--
-- 1º este banco (com os padrões nada muda para ninguém), 2º a edge calculate-shipping (com os padrões a resposta e o
-- hash da revisão são idênticos), 3º o front, SÓ depois de 1 e 2 conferidos naquela loja. Ordem invertida (painel
-- novo com a edge antiga) liga um laço na tela da cliente. Voltar a edge atrás com uma loja em "Só retiro" liga o
-- mesmo defeito: primeiro devolver a loja para "Entrego".
--
-- 10. ROLLBACK EM DOIS DEGRAUS
--
-- rollback-manual-20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql devolve os TRÊS corpos vivos byte a byte
-- (v23 6cb5a00cfa290f00dc9de053fee40759, v24 6002fc8db6c1d402bc704f018a0c2621, upsert
-- b562669936df1cda31d4bdd4d075bff3), refaz a view de 45 colunas e apaga a trigger; NÃO apaga as colunas, e RECUSA se
-- alguma loja estiver em "Só retiro" (a entrega própria volta a existir para ela sem a lojista ter pedido).
-- rollback-manual-destrutivo-20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql é o 2º degrau, em arquivo à
-- parte: apaga as duas colunas, e RECUSA se alguma loja tiver local_delivery_enabled = false ou prazo diferente de 1.
--
-- OS SUCESSORES: esta migration SUCEDE o corpo de create_marketplace_order_v23 (20261229000000), de
-- create_marketplace_order_v24 (20261236000000) e de upsert_store_config (20261239000000). As provas dessas migrations
-- desfazem esta, pelo rollback acima, antes de medir o estado delas (tests/banco/a-loja-escolhe-como-entrega-posterior.cjs),
-- e as consultas 31a, 37a, 40a, 8e e 9a a aceitam como sucessora.
--
-- PROVA VIVA: tests/banco/a-loja-escolhe-como-entrega-viva.cjs (matriz v23/v24 x convidado/logado x CEP local/fora x
-- três modos, equivalência com o padrão, trigger, upsert, pré-voo, rollback e mutantes).
-- ============================================================================

DO $preflight_20261244$
DECLARE
  r record;
  v_oid oid;
  v_hash text;
  v_public boolean;
  v_colunas text;
  v_tipo text;
BEGIN
  -- (1) As três funções: existência, sobrecarga e corpo (o vigente, ou o desta migration, para reaplicar). As
  --     tuplas seguem o formato ('assinatura', 'hash vigente', 'hash desta') que tests/banco/sucessoras-da-99.cjs lê
  --     para desfazer esta migration antes de medir a 20261199000000 (upsert_store_config é um dos 42 corpos dela).
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', '6cb5a00cfa290f00dc9de053fee40759', '79445d64a87843be2d42bf601c7090ec'),
        ('public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', '6002fc8db6c1d402bc704f018a0c2621', '85c37af4baa2f5ce1375bdd9e943c746'),
        ('public.upsert_store_config(jsonb)', 'b562669936df1cda31d4bdd4d075bff3', '391e8e1064400df5aea579f3472b203c')
      ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % não existe.', r.assinatura;
    END IF;
    IF (SELECT count(*) FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.proname = (SELECT proname FROM pg_proc WHERE oid = v_oid)) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % tem sobrecarga em public — meça a loja e revise antes de aplicar.', r.assinatura;
    END IF;

    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM r.hash_vigente AND v_hash IS DISTINCT FROM r.hash_desta THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % (hash %) não é o vigente antes desta migration nem o que ela deixa — capture o corpo vivo e revise antes de aplicar.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
  END LOOP;

  -- (1-bis) Atributos que o CREATE OR REPLACE reescreve e ACL: têm de ser os de sempre. PUBLIC não; authenticated e
  --     service_role sim; anon só nas duas RPCs de compra (o checkout da convidada precisa dele) e NÃO na upsert.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)',
         'p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid DEFAULT NULL::uuid',
         'uuid', true),
        ('public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)',
         'p_items jsonb, p_total_amount numeric, p_shipping_cost numeric, p_payment_method text, p_address_id uuid, p_coupon_code text, p_customer_name text, p_customer_phone text, p_observation text, p_address_data jsonb, p_destination_cep text, p_shipping_option_id text, p_idempotency_key uuid DEFAULT NULL::uuid',
         'uuid', true),
        ('public.upsert_store_config(jsonb)', 'config_json jsonb', 'jsonb', false)
      ) AS atributos(assinatura, argumentos, retorno, anon_executa)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_oid
            AND l.lanname = 'plpgsql'
            AND p.prosecdef
            AND p.provolatile = 'v'
            AND NOT p.proretset
            AND p.proconfig = ARRAY['search_path=public']::text[]
            AND pg_get_function_arguments(p.oid) = r.argumentos
            AND pg_get_function_result(p.oid) = r.retorno
       ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: atributos de % (linguagem, SECURITY DEFINER, volatilidade, search_path, argumentos ou tipo de retorno) não são os conhecidos — meça a loja e revise antes de aplicar.', r.assinatura;
    END IF;
    v_public := EXISTS (SELECT 1 FROM pg_proc p
                          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
    IF v_public
       OR has_function_privilege('anon', v_oid, 'EXECUTE') IS DISTINCT FROM r.anon_executa
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ACL de % não é a de sempre — meça a loja e revise antes de aplicar.', r.assinatura;
    END IF;
  END LOOP;

  -- (2) A lista de colunas da view: as 45 que a 20261239 deixou, ou essas 45 + as 2 desta migration (reaplicação).
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_colunas
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.v_store_config')
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_colunas IS NULL OR v_colunas NOT IN (
    'id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega,store_legal_name,store_legal_document,store_support_email',
    'id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega,store_legal_name,store_legal_document,store_support_email,local_delivery_enabled,local_delivery_days'
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a lista de colunas de v_store_config não é a que esta migration supõe (%) — revise antes de aplicar.', COALESCE(v_colunas, 'view ausente');
  END IF;

  -- (3) Se uma das colunas novas já existe na tabela, tem de ter o tipo certo: ADD COLUMN IF NOT EXISTS pularia em
  --     silêncio uma coluna de outro tipo.
  FOR r IN
    SELECT * FROM (VALUES ('local_delivery_enabled', 'boolean'), ('local_delivery_days', 'integer')) AS c(coluna, tipo)
  LOOP
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.store_config')
       AND a.attname = r.coluna AND NOT a.attisdropped;
    IF v_tipo IS NOT NULL AND v_tipo <> r.tipo THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: store_config.% já existe com o tipo % — esperava % ou ausente.', r.coluna, v_tipo, r.tipo;
    END IF;
  END LOOP;

  -- (4) A função da trigger: ausente, ou já com o corpo desta migration (reaplicação).
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.store_config_so_retirada_exige_retirada()');
  IF v_hash IS NOT NULL AND v_hash <> '979fe4cc3287c6ae254223bc1c28759e' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config_so_retirada_exige_retirada() já existe com outro corpo (hash %) — revise antes de aplicar.', v_hash;
  END IF;
END $preflight_20261244$;

-- Desiste em vez de enfileirar a vitrine (toda leitura de store_config) atrás do ALTER TABLE.
SET LOCAL lock_timeout = '5s';

-- (1) As colunas: ADITIVAS, NOT NULL com DEFAULT constante (toda loja existente nasce ligada, com 1 dia).
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS local_delivery_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS local_delivery_days integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.store_config'::regclass
       AND conname = 'store_config_local_delivery_days_check'
  ) THEN
    ALTER TABLE public.store_config
      ADD CONSTRAINT store_config_local_delivery_days_check
      CHECK (local_delivery_days BETWEEN 0 AND 30);
  END IF;
END $$;

-- (2) A trava do "Só retiro": a linha FINAL sem entrega própria TEM de oferecer a retirada, com endereço.
CREATE OR REPLACE FUNCTION public.store_config_so_retirada_exige_retirada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- O INSERT que só VAI desviar para o ON CONFLICT DO UPDATE da upsert_store_config não é a linha final (o candidato
  -- carrega o default de enabled_shipping_methods quando a chave não vem no payload): validar esse fantasma
  -- travaria salvamentos legítimos. A linha de verdade é a que o BEFORE UPDATE vê, sempre. (Mesma régua da
  -- store_config_exige_forma_de_pagamento, 20261174000000.)
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM public.store_config WHERE id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  -- "Só retiro" (entrega própria desligada) sem retirada ou sem endereço deixaria a loja SEM NENHUMA forma de
  -- entregar na cidade. COALESCE nas duas pontas: a coluna é NOT NULL, mas um NULL aqui nunca pode contar como
  -- "retirada oferecida".
  IF COALESCE(NEW.local_delivery_enabled, true) = false THEN
    IF COALESCE('store-pickup' = ANY(COALESCE(NEW.enabled_shipping_methods, '{}'::text[])), false) = false THEN
      RAISE EXCEPTION 'LOJA_SO_RETIRADA_SEM_RETIRADA'
        USING DETAIL = 'sem_retirada: a entrega própria está desligada e a retirada na loja (store-pickup em enabled_shipping_methods) não está ligada.';
    END IF;
    IF NULLIF(btrim(COALESCE(NEW.store_address, '')), '') IS NULL THEN
      RAISE EXCEPTION 'LOJA_SO_RETIRADA_SEM_RETIRADA'
        USING DETAIL = 'sem_endereco: a entrega própria está desligada e a loja não tem endereço físico (store_address) para a cliente retirar.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.store_config_so_retirada_exige_retirada() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS store_config_so_retirada_exige_retirada ON public.store_config;
CREATE TRIGGER store_config_so_retirada_exige_retirada
  BEFORE INSERT OR UPDATE ON public.store_config
  FOR EACH ROW
  EXECUTE FUNCTION public.store_config_so_retirada_exige_retirada();

-- (3) v_store_config: as 45 da 20261239 na MESMA ordem + as 2 novas no FIM. CREATE OR REPLACE (não DROP): acrescentar
-- no fim é o caso que ele aceita, e assim o ACL (anon/authenticated/service_role) e as opções da view não são
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
    store_support_email,
    local_delivery_enabled,
    local_delivery_days
   FROM store_config
  WHERE id = 1;

-- (4) upsert_store_config: BYTE A BYTE o corpo que a 20261239000000 deixou, com as ÚNICAS três trocas comentadas no
-- próprio corpo (lista de colunas do INSERT; VALUES com o default de fábrica; ON CONFLICT só do que veio no payload).
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
    local_delivery_enabled, local_delivery_days
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
    COALESCE((config_json->>'local_delivery_days')::integer, 1)
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
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

-- (5) create_marketplace_order_v23: o corpo vivo da 20261229000000 + as edições (a)-(d) do cabeçalho.
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

    -- A LOJA ESCOLHE COMO ENTREGA NA CIDADE (20261244000000, 16/10/2026): a coluna
    -- store_config.local_delivery_enabled (padrão true) desliga a ENTREGA PRÓPRIA
    -- ("Só retiro"). v_so_retirada = entrega própria desligada. v_retirada_livre =
    -- só retiro E a opção escolhida é exatamente 'store-pickup' (id canônico, sem
    -- normalizar): então a retirada vale para QUALQUER CEP (a cliente busca na
    -- loja) e as provas de "CEP local" abaixo deixam de valer SÓ para ela. As duas
    -- nascem false e só mudam depois que o passo 2 lê a configuração.
    v_so_retirada boolean := false;
    v_retirada_livre boolean := false;

    -- CPF DO DESTINATARIO (23/09/2026, migration 20261172000000): o CPF
    -- viaja dentro do jsonb ja existente p_address_data.cpf -- SEM
    -- parametro novo na assinatura. A v23 nunca GRAVA cpf (o 2-ter, ELSE,
    -- abaixo, sempre recusa transportadora nesta RPC antes do INSERT) --
    -- so precisa tirar a chave 'cpf' do objeto de endereco ANTES de
    -- grava-lo como customer_data.address, senao um payload {"cpf":"..."}
    -- sozinho (o front manda so isso para quem esta logado, onde
    -- p_address_data hoje e null) sobrescreveria/apagaria o endereco que
    -- o mapper do front le de customer_data.address (src/lib/mappers.ts,
    -- addressSource: um objeto {cpf} venceria o endereco real no OR).
    -- p_address_data - 'cpf' e NO-OP quando a chave nao existe (o caso de
    -- hoje, sem front novo); objeto que sobra vazio vira SQL NULL (nao
    -- '{}': '{}' e truthy em JS e venceria o endereco de verdade no OR do
    -- mapper -- NULL cai para a proxima fonte da cadeia). jsonb_typeof
    -- guarda contra payload nao-objeto (string/array/numero forjado).
    v_address_data_sem_cpf jsonb := CASE
        WHEN p_address_data IS NULL THEN NULL
        WHEN jsonb_typeof(p_address_data) <> 'object' THEN p_address_data
        WHEN (p_address_data - 'cpf') = '{}'::jsonb THEN NULL
        ELSE (p_address_data - 'cpf')
    END;
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

    -- 0-bis. FORMA DE PAGAMENTO DESLIGADA NA LOJA (formas de pagamento por
    -- loja, 25/09/2026 — revisão do desenho por um crítico externo, item B3):
    -- DEPOIS do passo 0 (idempotência), de propósito — o retry de um pedido
    -- que JÁ EXISTE (mesma chave) tem de voltar o pedido que já nasceu, mesmo
    -- que a loja tenha desligado esta forma de pagamento DEPOIS da compra
    -- confirmada; só pedido NOVO passa por aqui.
    -- public.forma_de_pagamento_aceita(p_metodo) é a fonte única: 'online'
    -- olha store_config.pagamento_online; 'pix'/'card'/'cash' olham
    -- store_config.formas_pagamento_entrega; qualquer outro valor de
    -- p_payment_method devolve false. A mensagem é TEXTO puro, sem prefixo
    -- de código — mesmo padrão de recusaDoPedido.ts (ver o cabeçalho daquele
    -- arquivo): casada por regex sobre `message`, nunca por ERRCODE.
    IF NOT public.forma_de_pagamento_aceita(p_payment_method) THEN
        RAISE EXCEPTION 'Esta forma de pagamento não está disponível nesta loja. Escolha outra.';
    END IF;

    -- 1. Address Ownership Check (Only if user is logged in)
    IF p_address_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
        END IF;
    END IF;

    -- 2. Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- ENTREGA PRÓPRIA DESLIGADA (20261244000000): coluna ausente ou NULL conta como
    -- LIGADA (COALESCE true) -- loja que nunca mexeu em nada se comporta como antes.
    v_so_retirada := (COALESCE(v_store_config.local_delivery_enabled, true) = false);
    v_retirada_livre := (v_so_retirada AND p_shipping_option_id IS NOT DISTINCT FROM 'store-pickup');

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
        -- 20261244000000: em "Só retiro" a retirada é livre de CEP (v_retirada_livre); toda
        -- outra opção do convidado continua exigindo o CEP local, como sempre.
        IF NOT v_retirada_livre AND NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
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
        -- 20261244000000: mesma exceção -- a retirada em "Só retiro" vale para qualquer CEP
        -- mesmo com a cobertura em "só a cidade" (a cliente vem buscar na loja).
        IF NOT v_retirada_livre AND NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
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
        -- ENTREGA PRÓPRIA DESLIGADA (20261244000000): a loja está em "Só retiro" e a entrega
        -- própria não existe mais. Quem ainda manda 'local-delivery' (app de antes, carrinho
        -- aberto, chamada direta) recebe a MESMA frase que o app já classifica como "volte ao
        -- carrinho e escolha outra entrega"; o DETAIL diz o porquê. Antes de qualquer outra prova.
        IF v_so_retirada THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = 'entrega_propria_desligada';
        END IF;
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
        -- 20261244000000: em "Só retiro" (v_retirada_livre) o CEP não precisa ser local -- só
        -- precisa existir. Nos outros modos a retirada segue só para a área local.
        IF v_cep_de_entrega IS NULL
           OR (NOT v_retirada_livre AND COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false) THEN
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

    -- 6-bis. O ENDEREÇO DA COMPRA FICA NO PEDIDO (20261229000000). Quem tem
    -- conta manda só o IDENTIFICADOR do endereço (p_address_id); sem esta
    -- cópia o pedido guardava só o ponteiro, e a tela e o painel liam o
    -- endereço ATUAL da conta: editar o endereço mudava o pedido já entregue,
    -- e apagá-lo (ON DELETE SET NULL) esvaziava o pedido. Copia o retrato do
    -- endereço da conta, NO INSTANTE da compra, para customer_data.address —
    -- a MESMA chave e as mesmas chaves que a convidada recebe (cep, street,
    -- number, neighborhood, city, state, complement) mais reference, que a
    -- ficha do pedido lê. Só quando:
    --   * há conta (v_user_id) — a convidada nunca dispara a cópia, nem
    --     mandando o id do endereço de outra pessoa;
    --   * não veio endereço digitado (v_address_data_sem_cpf IS NULL: o
    --     front de quem tem conta manda só {cpf} ou nada, e o CPF já foi
    --     separado acima) — o que o chamador mandou de verdade não é trocado;
    --   * não é retirada na loja (sem endereço de entrega).
    -- O dono do endereço foi provado no passo 1 e a leitura abaixo repete o
    -- filtro user_id = v_user_id: nunca copia endereço de outra pessoa.
    IF v_address_data_sem_cpf IS NULL
       AND v_user_id IS NOT NULL
       AND p_address_id IS NOT NULL
       AND p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN
        SELECT jsonb_strip_nulls(jsonb_build_object(
                   'cep', ua.cep,
                   'street', ua.street,
                   'number', ua.number,
                   'complement', ua.complement,
                   'neighborhood', ua.neighborhood,
                   'city', ua.city,
                   'state', ua.state,
                   'reference', ua.reference
               ))
          INTO v_address_data_sem_cpf
          FROM public.user_addresses ua
         WHERE ua.id = p_address_id AND ua.user_id = v_user_id;
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
            'address', v_address_data_sem_cpf,
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

-- (6) create_marketplace_order_v24: o corpo vivo da 20261236000000 + as mesmas edições.
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

    -- A LOJA ESCOLHE COMO ENTREGA NA CIDADE (20261244000000, 16/10/2026): a coluna
    -- store_config.local_delivery_enabled (padrão true) desliga a ENTREGA PRÓPRIA
    -- ("Só retiro"). v_so_retirada = entrega própria desligada. v_retirada_livre =
    -- só retiro E a opção escolhida é exatamente 'store-pickup' (id canônico, sem
    -- normalizar): então a retirada vale para QUALQUER CEP (a cliente busca na
    -- loja) e as provas de "CEP local" abaixo deixam de valer SÓ para ela. As duas
    -- nascem false e só mudam depois que o passo 2 lê a configuração.
    v_so_retirada boolean := false;
    v_retirada_livre boolean := false;

    -- CPF DO DESTINATARIO (23/09/2026, migration 20261172000000): o
    -- Melhor Envio exige to.document (CPF de pessoa fisica) para inserir
    -- o frete no carrinho e emitir a etiqueta de envio nacional
    -- (docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho). O
    -- CPF viaja dentro do jsonb ja existente p_address_data.cpf -- SEM
    -- parametro novo na assinatura. v_address_data_sem_cpf e o mesmo
    -- splice da v23 (ver comentario la): tira 'cpf' do objeto de endereco
    -- ANTES de grava-lo como customer_data.address, para nao apagar o
    -- endereco que o mapper do front le (src/lib/mappers.ts,
    -- addressSource).
    v_address_data_sem_cpf jsonb := CASE
        WHEN p_address_data IS NULL THEN NULL
        WHEN jsonb_typeof(p_address_data) <> 'object' THEN p_address_data
        WHEN (p_address_data - 'cpf') = '{}'::jsonb THEN NULL
        ELSE (p_address_data - 'cpf')
    END;

    -- CPF DO DESTINATARIO, continuacao: digitos extraidos aqui SEMPRE
    -- (independente da modalidade de frete) -- so USADOS (validados e
    -- gravados) quando v_opcao e transportadora, na checagem logo DEPOIS
    -- do END IF; que fecha o 2-ter (fora dele, de proposito -- contrato da
    -- 20261171 pede para nao mexer no 2-ter).
    -- AUSENTE = segue sem CPF: o app velho, sem o front atualizado para
    -- mandar o campo, continua fechando pedido de transportadora
    -- exatamente como hoje -- esta migration nao pode travar o checkout
    -- de quem ainda nao recebeu o front novo (ver "JANELA DE PUBLICACAO"
    -- no cabecalho). PRESENTE e mal-formado = recusa, sempre -- nunca
    -- grava lixo que a etiqueta rejeitaria na hora de emitir. Digitos
    -- verificadores conferidos aqui (Receita Federal, modulo 11) sao
    -- defesa em profundidade -- o FRONT tambem confere (src/lib/cpf.ts).
    v_customer_cpf_digits text := NULLIF(regexp_replace(COALESCE(p_address_data->>'cpf', ''), '\D', '', 'g'), '');
    v_cpf_digitos int[];
    v_cpf_soma1 integer;
    v_cpf_soma2 integer;
    v_cpf_dv1 integer;
    v_cpf_dv2 integer;
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

    -- 0-bis. FORMA DE PAGAMENTO DESLIGADA NA LOJA (formas de pagamento por
    -- loja, 25/09/2026 — revisão do desenho por um crítico externo, item B3):
    -- DEPOIS do passo 0 (idempotência), de propósito — o retry de um pedido
    -- que JÁ EXISTE (mesma chave) tem de voltar o pedido que já nasceu, mesmo
    -- que a loja tenha desligado esta forma de pagamento DEPOIS da compra
    -- confirmada; só pedido NOVO passa por aqui.
    -- public.forma_de_pagamento_aceita(p_metodo) é a fonte única: 'online'
    -- olha store_config.pagamento_online; 'pix'/'card'/'cash' olham
    -- store_config.formas_pagamento_entrega; qualquer outro valor de
    -- p_payment_method devolve false. A mensagem é TEXTO puro, sem prefixo
    -- de código — mesmo padrão de recusaDoPedido.ts (ver o cabeçalho daquele
    -- arquivo): casada por regex sobre `message`, nunca por ERRCODE.
    IF NOT public.forma_de_pagamento_aceita(p_payment_method) THEN
        RAISE EXCEPTION 'Esta forma de pagamento não está disponível nesta loja. Escolha outra.';
    END IF;

    -- 1. Address Ownership Check (Only if user is logged in)
    IF p_address_id IS NOT NULL AND v_user_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN
            RAISE EXCEPTION 'Endereço inválido ou não pertence ao usuário.';
        END IF;
    END IF;

    -- 2. Store Config
    SELECT * INTO v_store_config FROM public.store_config WHERE id = 1;

    -- ENTREGA PRÓPRIA DESLIGADA (20261244000000): coluna ausente ou NULL conta como
    -- LIGADA (COALESCE true) -- loja que nunca mexeu em nada se comporta como antes.
    v_so_retirada := (COALESCE(v_store_config.local_delivery_enabled, true) = false);
    v_retirada_livre := (v_so_retirada AND p_shipping_option_id IS NOT DISTINCT FROM 'store-pickup');

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
        -- 20261244000000: em "Só retiro" a retirada é livre de CEP (v_retirada_livre); toda
        -- outra opção do convidado continua exigindo o CEP local, como sempre.
        IF NOT v_retirada_livre AND NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
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
        -- 20261244000000: mesma exceção -- a retirada em "Só retiro" vale para qualquer CEP
        -- mesmo com a cobertura em "só a cidade" (a cliente vem buscar na loja).
        IF NOT v_retirada_livre AND NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN
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
        -- ENTREGA PRÓPRIA DESLIGADA (20261244000000): a loja está em "Só retiro" e a entrega
        -- própria não existe mais. Quem ainda manda 'local-delivery' (app de antes, carrinho
        -- aberto, chamada direta) recebe a MESMA frase que o app já classifica como "volte ao
        -- carrinho e escolha outra entrega"; o DETAIL diz o porquê. Antes de qualquer outra prova.
        IF v_so_retirada THEN
            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'
                USING DETAIL = 'entrega_propria_desligada';
        END IF;
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
        -- 20261244000000: em "Só retiro" (v_retirada_livre) o CEP não precisa ser local -- só
        -- precisa existir. Nos outros modos a retirada segue só para a área local.
        IF v_cep_de_entrega IS NULL
           OR (NOT v_retirada_livre AND COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false) THEN
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

    -- CPF DO DESTINATARIO (23/09/2026, migration 20261172000000): mora FORA
    -- do 2-ter acima, de propósito -- o contrato da 20261171
    -- (docs/superpowers/plans/2026-09-23-integracao-rpc-frete-nacional-e-
    -- cpf.md) pede para não mexer no 2-ter, e esta checagem é ADIÇÃO, não
    -- edição, então mora ao lado dele, repetindo a MESMA condição
    -- (v_opcao NOT IN (...)) que o ELSE do 2-ter já usa para chegar no
    -- ramo de transportadora -- o RAISE de meio de pagamento do 2-ter
    -- acima já interrompeu a função antes de chegar aqui quando o
    -- pagamento não combina, então a ordem de recusa (pagamento antes de
    -- CPF) continua a mesma de quando isto morava dentro do ELSE dele.
    -- Exigido SÓ em transportadora -- retirada e entrega local nunca
    -- exigem nem conferem CPF. AUSENTE não bloqueia (ver o comentário do
    -- DECLARE acima); PRESENTE e inválido bloqueia sempre, sem revelar o
    -- número no texto do erro (nunca RAISE com o CPF).
    IF v_opcao NOT IN ('local-delivery', 'store-pickup') AND v_customer_cpf_digits IS NOT NULL THEN
        IF length(v_customer_cpf_digits) <> 11
           OR v_customer_cpf_digits ~ '^(\d)\1{10}$' THEN
            RAISE EXCEPTION 'CPF do destinatário inválido. Confira o número informado.'
                USING DETAIL = 'CPF com formato ou quantidade de dígitos inválida.';
        END IF;

        -- Digito verificador (Receita Federal, modulo 11): d10 pesa
        -- 1..9 por 10..2 (peso = 11-i), d11 pesa 1..10 por 11..2 (peso
        -- = 12-i). Sequencia com todos os digitos iguais (000...,
        -- 111... etc) passaria a formula por coincidencia e nunca e
        -- CPF real -- recusada junto no primeiro IF acima.
        SELECT array_agg(substr(v_customer_cpf_digits, gs, 1)::int ORDER BY gs)
          INTO v_cpf_digitos
          FROM generate_series(1, 11) AS gs;

        SELECT SUM(v_cpf_digitos[i] * (11 - i)) % 11 INTO v_cpf_soma1
          FROM generate_series(1, 9) AS i;
        v_cpf_dv1 := CASE WHEN v_cpf_soma1 < 2 THEN 0 ELSE 11 - v_cpf_soma1 END;

        SELECT SUM(v_cpf_digitos[i] * (12 - i)) % 11 INTO v_cpf_soma2
          FROM generate_series(1, 10) AS i;
        v_cpf_dv2 := CASE WHEN v_cpf_soma2 < 2 THEN 0 ELSE 11 - v_cpf_soma2 END;

        IF v_cpf_digitos[10] <> v_cpf_dv1 OR v_cpf_digitos[11] <> v_cpf_dv2 THEN
            RAISE EXCEPTION 'CPF do destinatário inválido. Confira o número informado.'
                USING DETAIL = 'Dígito verificador do CPF não confere (módulo 11).';
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

    -- 6-ter. COMPRA QUE DÁ R$ 0,00 NÃO SE PAGA PELO APP (20261236000000). A
    -- v24 é a RPC do pagamento ANTECIPADO: carimba 'aguardando' e a reserva de
    -- 30 minutos (estoque e vaga do cupom). Só que `criar-pagamento` recusa
    -- pedido de valor zero (não existe cobrança de R$ 0,00 no Mercado Pago),
    -- então o pedido que o cupom zera (com frete zero) nascia aqui sem
    -- nenhuma forma de ser pago e segurava estoque e vaga do cupom até a
    -- expiração. Recusa AQUI, com o total JÁ calculado pelo servidor
    -- (subtotal + frete - desconto; nunca o que o cliente mandou), ANTES do
    -- INSERT do pedido, da baixa do estoque (passo 8) e do uso do cupom
    -- (passo 9). Só vale para o meio de pagamento pelo app ('online'): pix,
    -- card e cash ("pagar na retirada ou na entrega") seguem como antes, e o
    -- pedido de R$ 0,00 na entrega continua nascendo normalmente (é a v23 que
    -- o app chama nesse caso). Texto SEM prefixo de código (padrão de
    -- recusaDoPedido.ts: casado por regex sobre `message`); o identificador
    -- estável da recusa vai no DETAIL.
    IF p_payment_method = 'online' AND round(v_calculated_total, 2) <= 0 THEN
        RAISE EXCEPTION 'Este pedido não tem valor a pagar pelo app. Escolha pagar na retirada ou na entrega, ou fale com a loja.'
            USING DETAIL = format('pedido_sem_valor_a_pagar_pelo_app: subtotal %s + frete %s - desconto %s = total %s.',
                v_calculated_subtotal, v_shipping_validated, v_discount_amount, v_calculated_total);
    END IF;

    -- 6-bis. O ENDEREÇO DA COMPRA FICA NO PEDIDO (20261229000000). Quem tem
    -- conta manda só o IDENTIFICADOR do endereço (p_address_id); sem esta
    -- cópia o pedido guardava só o ponteiro, e a tela e o painel liam o
    -- endereço ATUAL da conta: editar o endereço mudava o pedido já entregue,
    -- e apagá-lo (ON DELETE SET NULL) esvaziava o pedido. Copia o retrato do
    -- endereço da conta, NO INSTANTE da compra, para customer_data.address —
    -- a MESMA chave e as mesmas chaves que a convidada recebe (cep, street,
    -- number, neighborhood, city, state, complement) mais reference, que a
    -- ficha do pedido lê. Só quando:
    --   * há conta (v_user_id) — a convidada nunca dispara a cópia, nem
    --     mandando o id do endereço de outra pessoa;
    --   * não veio endereço digitado (v_address_data_sem_cpf IS NULL: o
    --     front de quem tem conta manda só {cpf} ou nada, e o CPF já foi
    --     separado acima) — o que o chamador mandou de verdade não é trocado;
    --   * não é retirada na loja (sem endereço de entrega).
    -- O dono do endereço foi provado no passo 1 e a leitura abaixo repete o
    -- filtro user_id = v_user_id: nunca copia endereço de outra pessoa.
    IF v_address_data_sem_cpf IS NULL
       AND v_user_id IS NOT NULL
       AND p_address_id IS NOT NULL
       AND p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN
        SELECT jsonb_strip_nulls(jsonb_build_object(
                   'cep', ua.cep,
                   'street', ua.street,
                   'number', ua.number,
                   'complement', ua.complement,
                   'neighborhood', ua.neighborhood,
                   'city', ua.city,
                   'state', ua.state,
                   'reference', ua.reference
               ))
          INTO v_address_data_sem_cpf
          FROM public.user_addresses ua
         WHERE ua.id = p_address_id AND ua.user_id = v_user_id;
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
            'address', v_address_data_sem_cpf,
            'shipping_option_id', p_shipping_option_id,
            'destination_cep', v_dest_cep
        )
        -- RETIRADA NA LOJA (20261169000000): o RETRATO do endereço físico
        -- da loja no instante da compra — o pedido não muda se a loja
        -- mudar de endereço depois (mesma régua do snapshot do endereço
        -- da cliente). O 2-ter já provou que ele não está vazio.
        || CASE WHEN p_shipping_option_id = 'store-pickup'
                THEN jsonb_build_object('pickup_address', btrim(v_store_config.store_address))
                ELSE '{}'::jsonb END
        -- CPF DO DESTINATARIO (23/09/2026, migration 20261172000000): so
        -- grava quando a modalidade e TRANSPORTADORA (v_opcao fora de
        -- local-delivery/store-pickup) -- retirada e entrega local NUNCA
        -- gravam a chave, mesmo que o payload tenha mandado um CPF
        -- (formulario reaproveitado de uma escolha anterior). O 2-ter,
        -- acima, ja validou (ou recusou) o CPF quando presente nesse
        -- ramo; aqui so decide GRAVAR ou NAO -- v_customer_cpf_digits
        -- pode ser NULL (CPF ausente: segue sem gravar nada).
        || CASE WHEN v_opcao NOT IN ('local-delivery', 'store-pickup') AND v_customer_cpf_digits IS NOT NULL
                THEN jsonb_build_object('cpf', v_customer_cpf_digits)
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

-- (7) Pós-voo: o desenho ficou como disse, ou nada fica.
DO $posvoo_20261244$
DECLARE
  r record;
  v_oid oid;
  v_hash text;
  v_public boolean;
  v_colunas text;
  v_n integer;
BEGIN
  -- As três funções com o corpo desta migration, os atributos e a ACL de antes.
  FOR r IN
    SELECT *
      FROM (VALUES
        ('create_marketplace_order_v23', 'public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', '79445d64a87843be2d42bf601c7090ec', true),
        ('create_marketplace_order_v24', 'public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)', '85c37af4baa2f5ce1375bdd9e943c746', true),
        ('upsert_store_config', 'public.upsert_store_config(jsonb)', '391e8e1064400df5aea579f3472b203c', false)
      ) AS esperado(nome, assinatura, hash_novo, anon_executa)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS DISTINCT FROM r.hash_novo THEN
      RAISE EXCEPTION 'POSVOO_20261244000000: % não ficou com o corpo desta migration (hash %)', r.nome, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
          WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prosecdef AND p.provolatile = 'v'
            AND p.proconfig = ARRAY['search_path=public']::text[]
       ) THEN
      RAISE EXCEPTION 'POSVOO_20261244000000: % perdeu um atributo (linguagem, SECURITY DEFINER, volatilidade ou search_path)', r.nome;
    END IF;
    v_public := EXISTS (SELECT 1 FROM pg_proc p
                          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                         WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0);
    IF v_public
       OR has_function_privilege('anon', v_oid, 'EXECUTE') IS DISTINCT FROM r.anon_executa
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'POSVOO_20261244000000: a ACL de % mudou', r.nome;
    END IF;
  END LOOP;

  -- As duas colunas: tipo, NOT NULL e DEFAULT exatos.
  SELECT count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'store_config'
     AND ((column_name = 'local_delivery_enabled' AND data_type = 'boolean' AND is_nullable = 'NO' AND column_default = 'true')
       OR (column_name = 'local_delivery_days' AND data_type = 'integer' AND is_nullable = 'NO' AND column_default = '1'));
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'POSVOO_20261244000000: esperava 2 colunas NOT NULL com os defaults true e 1 em store_config, achei %', v_n;
  END IF;

  -- A CHECK do prazo: de 0 a 30, validada.
  SELECT count(*) INTO v_n
    FROM pg_constraint
   WHERE conrelid = 'public.store_config'::regclass
     AND conname = 'store_config_local_delivery_days_check'
     AND contype = 'c' AND convalidated
     AND pg_get_constraintdef(oid) = 'CHECK (((local_delivery_days >= 0) AND (local_delivery_days <= 30)))';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261244000000: a CHECK do prazo da entrega própria (0 a 30) não ficou como o desenho diz';
  END IF;

  -- A trigger: ligada, BEFORE INSERT OR UPDATE por linha, apontando para a função certa, que ninguém executa à mão.
  SELECT count(*) INTO v_n
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.store_config'::regclass
     AND t.tgname = 'store_config_so_retirada_exige_retirada'
     AND NOT t.tgisinternal
     AND t.tgenabled = 'O'
     AND t.tgtype = 23
     AND t.tgfoid = to_regprocedure('public.store_config_so_retirada_exige_retirada()');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'POSVOO_20261244000000: a trigger store_config_so_retirada_exige_retirada não ficou ligada como BEFORE INSERT OR UPDATE por linha';
  END IF;
  SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash
    FROM pg_proc WHERE oid = to_regprocedure('public.store_config_so_retirada_exige_retirada()');
  IF v_hash IS DISTINCT FROM '979fe4cc3287c6ae254223bc1c28759e' THEN
    RAISE EXCEPTION 'POSVOO_20261244000000: a função da trigger não ficou com o corpo desta migration (hash %)', COALESCE(v_hash, 'ausente');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.store_config_so_retirada_exige_retirada()')
                    AND p.prosecdef
                    AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[])
     OR EXISTS (SELECT 1 FROM pg_proc p
                  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = to_regprocedure('public.store_config_so_retirada_exige_retirada()')
                   AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
     OR has_function_privilege('anon', to_regprocedure('public.store_config_so_retirada_exige_retirada()'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.store_config_so_retirada_exige_retirada()'), 'EXECUTE')
     OR has_function_privilege('service_role', to_regprocedure('public.store_config_so_retirada_exige_retirada()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'POSVOO_20261244000000: a função da trigger perdeu SECURITY DEFINER, o search_path ou ganhou EXECUTE para alguém';
  END IF;

  -- A view: as 47 colunas, legível pelos três papéis de sempre (a tabela por baixo também: a view é security_invoker).
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_colunas
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.v_store_config') AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_colunas IS DISTINCT FROM 'id,free_shipping_min,shipping_fee,whatsapp_number,share_text,business_hours,enable_reviews,enable_coupons,primary_color,theme_mode,logo_url,real_time_sales_alerts,push_marketing_enabled,min_app_version,origin_cep,shipping_provider,enabled_shipping_methods,shipping_coverage,local_delivery_fee,local_cep_range,created_at,updated_at,store_name,store_city,store_state,home_sections,secondary_color,accent_color,branding_assets,dominio_publico,mp_public_key,vapid_public_key,pagamento_online,manutencao,store_address,store_description,national_shipping_strategy,national_shipping_min,national_discount_type,national_discount_value,national_benefit_scope,formas_pagamento_entrega,store_legal_name,store_legal_document,store_support_email,local_delivery_enabled,local_delivery_days' THEN
    RAISE EXCEPTION 'POSVOO_20261244000000: a lista de colunas de v_store_config não ficou como o desenho diz (%)', COALESCE(v_colunas, 'view ausente');
  END IF;
  IF NOT has_table_privilege('anon', 'public.v_store_config', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.v_store_config', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.v_store_config', 'SELECT') THEN
    RAISE EXCEPTION 'POSVOO_20261244000000: v_store_config perdeu o SELECT de anon, authenticated ou service_role';
  END IF;
  IF NOT has_column_privilege('anon', 'public.store_config', 'local_delivery_enabled', 'SELECT')
     OR NOT has_column_privilege('anon', 'public.store_config', 'local_delivery_days', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.store_config', 'local_delivery_enabled', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.store_config', 'local_delivery_days', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.store_config', 'local_delivery_enabled', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.store_config', 'local_delivery_days', 'SELECT') THEN
    RAISE EXCEPTION 'POSVOO_20261244000000: anon, authenticated ou service_role não leem as colunas novas de store_config (a view security_invoker quebraria)';
  END IF;
  PERFORM local_delivery_enabled, local_delivery_days FROM public.v_store_config;
END $posvoo_20261244$;

-- Pós-DDL: DDL aplicado por conexão direta NÃO recarrega o schema cache do PostgREST — sem o NOTIFY abaixo o
-- `select=*` da REST segue devolvendo store_config e v_store_config SEM as colunas novas. Idempotente.
NOTIFY pgrst, 'reload schema';
