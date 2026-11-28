-- ============================================================================
-- Migration 20261652000000 — a loja nova confirma a entrega e o pagamento que vieram de fabrica
-- (decisao de produto do socio, 27/11/2026; ADITIVA: duas colunas novas e o corpo de upsert_store_config; nenhuma
-- linha e lida para reescrita e nenhum UPDATE roda)
-- ============================================================================
--
-- 1. O DEFEITO
--
--   O checklist "Loja pronta" do Inicio do painel marcava dois passos como FEITOS sem a lojista escolher nada:
--     - "Como voce recebe": a loja nasce com Pix, cartao e dinheiro na entrega ligados (formas_pagamento_entrega
--       DEFAULT {pix,card,cash});
--     - "Como voce entrega": basta um CEP terminado em 000 para a entrega na cidade valer com os valores de fabrica
--       (local_delivery_fee 10, local_delivery_days 1).
--   A lojista que nunca abriu Frete nem Pagamentos via "Loja pronta" e vendia aceitando cartao sem maquininha e
--   cobrando R$ 10 que ninguem decidiu. Agora o painel mostra o que vale e pede um toque de confirmacao.
--
-- 2. O QUE ESTA MIGRATION FAZ, NA ORDEM
--
--   0. Pre-voo (B1_BASELINE_DIVERGENT, antes de qualquer escrita; ver 5) e fotografia de upsert_store_config.
--   1. Duas colunas novas em public.store_config, ANULAVEIS e SEM default no fim:
--        entrega_confirmada_em    timestamptz   quando a lojista confirmou a entrega na cidade (NULL = ainda nao);
--        pagamento_confirmado_em  timestamptz   quando confirmou as formas de pagamento (NULL = ainda nao).
--   2. `CREATE OR REPLACE` de `public.upsert_store_config(jsonb)` com o corpo VIVO da 20261643000000 e SO isto a mais:
--        a) as chaves opcionais `entrega_confirmada_em` e `pagamento_confirmado_em` do payload SO aceitam `true`
--           (qualquer outro valor: 22023 'Confirmação inválida.', antes de gravar qualquer coisa);
--        b) com a chave, a coluna recebe now() do BANCO (nunca a hora do aparelho) e a PRIMEIRA confirmacao fica
--           (COALESCE: confirmar de novo nao muda a data; nao existe "desconfirmar");
--        c) sem a chave, a coluna nao muda (o CASE por coluna da casa).
--      As duas travas de admin (is_admin e is_admin_atual), a conferencia das listas vistas (LST01), o INSERT ... ON
--      CONFLICT, a assinatura, SECURITY DEFINER, `search_path = public`, VOLATILE, dono e ACL ficam IGUAIS (CREATE OR
--      REPLACE preserva OID, dono e ACL; a conferencia compara com a fotografia). Nenhum GRANT nem REVOKE.
--   3. Conferencia no fim (aborta a migration inteira se algo nao ficou como desenhado).
--
-- 3. DADOS EXISTENTES — a loja que JA EXISTE nasce confirmada, a loja NOVA nasce pendente
--
--   Loja que ja existe: as colunas nascem com o instante do apply pelo DEFAULT now() do proprio ADD COLUMN (o Postgres
--   11+ avalia o default nao volatil UMA vez e o guarda no catalogo para as linhas que ja existem: nada e reescrito,
--   nenhum gatilho de linha dispara, o livro de registro nao ganha linha), e o DEFAULT e tirado logo em seguida
--   (DROP DEFAULT): a linha que nascer DEPOIS nasce NULL. Para essa loja nada muda no painel.
--   Loja NOVA: o instalador (scripts/frota/instalador-banco.mjs) aplica a fila inteira num banco vazio, e a ficha id = 1
--   ja existe quando esta migration roda (quem a semeia e a 20261540000000, antes na fila). O que distingue as duas e a
--   MARCA DE INSTALACAO: supabase_migrations.ikcous_instalacao id = 1 com concluida_em NULL enquanto o instalador roda
--   a fila (nenhuma loja de hoje tem a marca; a loja que o instalador terminou tem concluida_em preenchido). Com a
--   marca EM CURSO as colunas nascem SEM o default (a ficha fica NULL: pendente). Sem marca, ou com ela concluida, e
--   loja que ja existe. O front que cria a ficha sozinho (StoreContext, admin sem linha) nao cita as colunas: NULL.
--   Nenhuma outra coluna, linha, tabela, gatilho, politica ou view muda (v_store_config, publica, NAO ganha as colunas).
--
-- 4. IDEMPOTENCIA, TRANSACAO E TRAVA
--
--   Reaplicar deixa o mesmo estado: coluna que ja existe (com a forma desta) nao e recriada nem recarimbada; o corpo e
--   o mesmo texto. Sem BEGIN/COMMIT de nivel superior (regra da casa, AGENTS.md): quem abre a transacao e o aplicador
--   (`aplicar-migrations.yml` / `node scripts/db-apply.cjs <arquivo>` / o instalador); pre-voo, colunas, corpo e
--   conferencia caem juntos ou nao caem. O ADD COLUMN pega trava de store_config: `lock_timeout = 5s` faz a migration
--   DESISTIR (55P03, nada gravado) em vez de enfileirar a vitrine atras dela; aplicar de novo fora do pico.
--
-- 5. PRE-VOO
--
--   Recusa se: is_admin() / is_admin_atual() ausentes; upsert_store_config ausente, com sobrecarga, com corpo que nao
--   seja o da 20261643000000 nem o desta, com atributos diferentes (plpgsql, SECURITY DEFINER, VOLATILE,
--   search_path=public, retorno jsonb) ou com EXECUTE aberto a PUBLIC/anon ou fechado ao authenticated/service_role;
--   uma das colunas novas ja existir com outra forma (tipo diferente de timestamptz, NOT NULL ou com default) ou so uma
--   das duas existir.
--
-- 6. ORDEM E QUEM QUEBRA
--
--   Depois da 20261643000000 (o corpo vivo dela e a base) e da 20261540000000 (a ficha). Banco e front em qualquer
--   ordem: o front novo le coluna AUSENTE como "confirmado" (o comportamento de hoje) e so manda a chave de confirmacao
--   quando le a coluna presente e vazia; o front antigo nunca manda a chave e nao le as colunas. As provas que medem o
--   corpo da 20261643000000 (e as da cadeia dela) tiram esta antes: tests/banco/a-loja-nova-confirma-posterior.cjs.
--
-- 7. FICHA DE VERIFICACAO (so leitura)
--
--   -- Corpo (esperado: 3c62896ca905200f1a931ac6ccfed297):
--   SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)');
--   Consultas oficiais: 208a (depois) / 208b (antes), em scripts/publicacao/consultas/.
--
-- 8. ROLLBACK
--
--   rollback-manual-20261652000000_a_loja_nova_confirma_entrega_e_pagamento.sql devolve o corpo da 20261643000000 byte a
--   byte (md5 2f772ffd1370359ba6c64540b71c35b2) e apaga SO as duas colunas novas (as datas de confirmacao se perdem, e
--   com a coluna ausente o painel volta a tratar tudo como confirmado: o comportamento de antes).
--
-- PROVA VIVA: tests/banco/a-loja-nova-confirma-entrega-e-pagamento-viva.cjs (rpc-ci, Postgres efemero).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261652000000$
DECLARE
  r record;
  v_oid oid;
  v_hash text;
  v_colunas integer;
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL OR to_regprocedure('public.is_admin_atual()') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.is_admin() ou public.is_admin_atual() nao existe -- aplique a 20261197000000 antes.';
  END IF;
  IF to_regclass('public.store_config') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.store_config ausente.';
  END IF;

  -- A tupla ('assinatura', 'hash vigente', 'hash desta') e o formato que tests/banco/sucessoras-da-99.cjs le.
  FOR r IN SELECT * FROM (VALUES
    ('public.upsert_store_config(jsonb)', '2f772ffd1370359ba6c64540b71c35b2', '3c62896ca905200f1a931ac6ccfed297')
  ) AS esperado(assinatura, hash_vigente, hash_desta)
  LOOP
    v_oid := to_regprocedure(r.assinatura);
    IF v_oid IS NULL
       OR (SELECT count(*) FROM pg_proc q
            WHERE q.pronamespace = 'public'::regnamespace
              AND q.proname = (SELECT p.proname FROM pg_proc p WHERE p.oid = v_oid)) <> 1 THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ausente ou com sobrecarga em public -- meca a loja (consulta 208b) e revise antes de aplicar.', r.assinatura;
    END IF;
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_oid;
    IF v_hash IS NULL OR v_hash NOT IN (r.hash_vigente, r.hash_desta) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de % desconhecido (%) -- nao e o da 20261643000000 nem o desta.', r.assinatura, COALESCE(v_hash, 'ausente');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
       WHERE p.oid = v_oid
         AND p.prokind = 'f' AND p.prosecdef AND l.lanname = 'plpgsql' AND p.provolatile = 'v'
         AND p.proconfig = ARRAY['search_path=public']::text[]
         AND pg_get_function_result(p.oid) = 'jsonb' AND NOT p.proretset
    ) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % nao e SECURITY DEFINER plpgsql VOLATILE com search_path=public e retorno jsonb -- revise antes de aplicar.', r.assinatura;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                WHERE p.oid = v_oid AND g.privilege_type = 'EXECUTE' AND g.grantee = 0)
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o EXECUTE de % nao e o de sempre (so authenticated e service_role) -- revise antes de aplicar.', r.assinatura;
    END IF;
  END LOOP;

  -- As colunas novas: ausentes as DUAS (primeiro apply) ou presentes as DUAS com a forma desta (reaplicar).
  SELECT count(*) INTO v_colunas FROM pg_attribute a
   WHERE a.attrelid = 'public.store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('entrega_confirmada_em', 'pagamento_confirmado_em');
  IF v_colunas = 1 OR (v_colunas = 2 AND (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = 'public.store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attname IN ('entrega_confirmada_em', 'pagamento_confirmado_em')
         AND a.atttypid = 'timestamptz'::regtype AND NOT a.attnotnull AND NOT a.atthasdef) <> 2) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: store_config tem entrega_confirmada_em/pagamento_confirmado_em pela metade ou com outra forma (esperado: as duas timestamptz, anulaveis, sem default) -- meca a loja e revise antes de aplicar.';
  END IF;

  -- Fotografia de tudo que a RPC e no catalogo (OID, dono, ACL, atributos): o CREATE OR REPLACE so pode trocar o corpo.
  PERFORM set_config('ikcous.confirma1652_upsert',
    (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = to_regprocedure('public.upsert_store_config(jsonb)'))::text, true);
END $preflight_20261652000000$;

-- ---------------------------------------------------------------------------
-- 1. As duas colunas: a loja que ja existe nasce confirmada; a loja nova (instalacao em curso), pendente.
-- ---------------------------------------------------------------------------
DO $colunas_20261652000000$
DECLARE
  v_loja_em_instalacao boolean := false;
BEGIN
  -- A marca do instalador (scripts/frota/instalador-banco.mjs): concluida_em NULL = a fila esta sendo aplicada num banco
  -- NOVO agora. Lida por EXECUTE porque a tabela so existe nas lojas que o instalador criou.
  IF to_regclass('supabase_migrations.ikcous_instalacao') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM supabase_migrations.ikcous_instalacao WHERE id = 1 AND concluida_em IS NULL)'
      INTO v_loja_em_instalacao;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'public.store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                    AND a.attname = 'entrega_confirmada_em') THEN
    IF v_loja_em_instalacao THEN
      ALTER TABLE public.store_config ADD COLUMN entrega_confirmada_em timestamptz;
      ALTER TABLE public.store_config ADD COLUMN pagamento_confirmado_em timestamptz;
    ELSE
      -- DEFAULT nao volatil no ADD COLUMN: o valor vale para as linhas que JA existem sem reescrever nenhuma; o DROP
      -- DEFAULT logo depois faz a linha que nascer depois nascer NULL.
      ALTER TABLE public.store_config ADD COLUMN entrega_confirmada_em timestamptz DEFAULT now();
      ALTER TABLE public.store_config ALTER COLUMN entrega_confirmada_em DROP DEFAULT;
      ALTER TABLE public.store_config ADD COLUMN pagamento_confirmado_em timestamptz DEFAULT now();
      ALTER TABLE public.store_config ALTER COLUMN pagamento_confirmado_em DROP DEFAULT;
    END IF;
  END IF;
END $colunas_20261652000000$;

COMMENT ON COLUMN public.store_config.entrega_confirmada_em IS
  'Quando a lojista confirmou a entrega na cidade (valor e prazo). NULL = a loja nova ainda nao confirmou o que veio de fabrica.';
COMMENT ON COLUMN public.store_config.pagamento_confirmado_em IS
  'Quando a lojista confirmou as formas de pagamento na entrega. NULL = a loja nova ainda nao confirmou o que veio de fabrica.';

-- ---------------------------------------------------------------------------
-- 2. upsert_store_config: corpo da 20261643000000 com as duas chaves de confirmacao
-- ---------------------------------------------------------------------------
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
  -- 20261643000000: a lista que a tela VIU (opcional) e o que o banco tem.
  v_vistos jsonb;
  v_formas_no_banco text[];
  v_vitrines_no_banco jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;
  -- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).
  IF NOT public.is_admin_atual() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  -- 20261652000000: a lojista CONFIRMA o que a loja nova traz de fabrica (a entrega na
  -- cidade e as formas de pagamento na entrega). A chave so aceita `true`: quem carimba e o
  -- relogio do banco, nunca o do aparelho, e a primeira confirmacao fica (confirmar de novo
  -- nao muda a data; nao existe "desconfirmar"). Qualquer outro valor (false, null, texto,
  -- data) recusa ANTES de gravar qualquer coisa.
  IF (config_json ? 'entrega_confirmada_em'
        AND config_json->'entrega_confirmada_em' IS DISTINCT FROM 'true'::jsonb)
     OR (config_json ? 'pagamento_confirmado_em'
        AND config_json->'pagamento_confirmado_em' IS DISTINCT FROM 'true'::jsonb) THEN
    RAISE EXCEPTION 'Confirmação inválida.' USING ERRCODE = '22023';
  END IF;

  -- AS LISTAS NAO SOMEM ENTRE APARELHOS (20261643000000): vitrines e formas
  -- na entrega sao gravadas INTEIRAS a partir da copia da tela. `vistos`
  -- (opcional) traz a lista que a tela VIU; diferente da do banco = outro
  -- aparelho gravou no meio: recusa (LST01, DETAIL = a coluna) ANTES de gravar
  -- qualquer coisa. Sem `vistos` (app antigo) grava como sempre. A linha fica
  -- travada (FOR UPDATE) da conferencia ao fim da transacao: dois aparelhos
  -- ao mesmo tempo se enfileiram e o segundo confere contra o que o primeiro
  -- gravou. Formas comparam como conjunto (a ordem e a canonica da tela);
  -- vitrines comparam o jsonb inteiro (a ordem e a da Home). Vitrine nunca
  -- salva (NULL ou null) nao tem o que perder: aceita.
  IF config_json ? 'vistos' THEN
    v_vistos := config_json->'vistos';
    IF jsonb_typeof(v_vistos) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Lista vista inválida.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_vistos) k
                WHERE k NOT IN ('formas_pagamento_entrega', 'home_sections')) THEN
      RAISE EXCEPTION 'Lista vista inválida.' USING ERRCODE = '22023';
    END IF;
    IF v_vistos ? 'formas_pagamento_entrega' THEN
      IF jsonb_typeof(v_vistos->'formas_pagamento_entrega') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Lista vista inválida.' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_vistos->'formas_pagamento_entrega') e
                  WHERE jsonb_typeof(e) <> 'string') THEN
        RAISE EXCEPTION 'Lista vista inválida.' USING ERRCODE = '22023';
      END IF;
    END IF;

    SELECT s.formas_pagamento_entrega, s.home_sections
      INTO v_formas_no_banco, v_vitrines_no_banco
      FROM public.store_config s
     WHERE s.id = 1
       FOR UPDATE;

    IF v_vistos ? 'formas_pagamento_entrega'
       AND v_formas_no_banco IS NOT NULL
       AND ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(v_vistos->'formas_pagamento_entrega') x ORDER BY 1)
           IS DISTINCT FROM ARRAY(SELECT DISTINCT x FROM unnest(v_formas_no_banco) x ORDER BY 1) THEN
      RAISE EXCEPTION 'A lista foi mudada em outro aparelho.'
        USING ERRCODE = 'LST01', DETAIL = 'formas_pagamento_entrega';
    END IF;
    IF v_vistos ? 'home_sections'
       AND NULLIF(v_vitrines_no_banco, 'null'::jsonb) IS NOT NULL
       AND v_vitrines_no_banco IS DISTINCT FROM v_vistos->'home_sections' THEN
      RAISE EXCEPTION 'A lista foi mudada em outro aparelho.'
        USING ERRCODE = 'LST01', DETAIL = 'home_sections';
    END IF;
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
    local_delivery_enabled, local_delivery_days, free_shipping_card_style,
    entrega_confirmada_em, pagamento_confirmado_em
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
    COALESCE(config_json->>'free_shipping_card_style', 'completo'),
    -- 20261652000000: com a chave, a confirmacao nasce do relogio do banco; sem ela, NULL
    -- (a loja nova ainda nao confirmou).
    CASE WHEN config_json ? 'entrega_confirmada_em' THEN now() END,
    CASE WHEN config_json ? 'pagamento_confirmado_em' THEN now() END
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
    -- 20261652000000: a PRIMEIRA confirmacao fica (COALESCE); sem a chave, nada muda.
    entrega_confirmada_em = CASE WHEN config_json ? 'entrega_confirmada_em'
      THEN COALESCE(store_config.entrega_confirmada_em, now())
      ELSE store_config.entrega_confirmada_em END,
    pagamento_confirmado_em = CASE WHEN config_json ? 'pagamento_confirmado_em'
      THEN COALESCE(store_config.pagamento_confirmado_em, now())
      ELSE store_config.pagamento_confirmado_em END,
    updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;

  RETURN result;
END;
$$;

-- CONFERENCIA no instante do apply: aborta a migration inteira se algo nao ficou como desenhado.
DO $conferencia_20261652000000$
DECLARE
  v_oid oid := to_regprocedure('public.upsert_store_config(jsonb)');
BEGIN
  IF v_oid IS NULL
     OR (SELECT count(*) FROM pg_proc q WHERE q.pronamespace = 'public'::regnamespace AND q.proname = 'upsert_store_config') <> 1 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: 20261652000000 -- upsert_store_config sumiu ou ganhou sobrecarga.';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM '3c62896ca905200f1a931ac6ccfed297' THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: 20261652000000 -- o corpo vivo de upsert_store_config nao e o desta migration.';
  END IF;
  IF (SELECT to_jsonb(p) - 'prosrc' FROM pg_proc p WHERE p.oid = v_oid)
       IS DISTINCT FROM current_setting('ikcous.confirma1652_upsert')::jsonb THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: 20261652000000 -- OID, dono, ACL ou atributo de upsert_store_config mudou.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = 'public.store_config'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attname IN ('entrega_confirmada_em', 'pagamento_confirmado_em')
         AND a.atttypid = 'timestamptz'::regtype AND NOT a.attnotnull AND NOT a.atthasdef) <> 2 THEN
    RAISE EXCEPTION 'B2_POSVOO_DIVERGENTE: 20261652000000 -- as duas colunas de confirmacao nao ficaram timestamptz, anulaveis e sem default.';
  END IF;
END $conferencia_20261652000000$;

NOTIFY pgrst, 'reload schema';
