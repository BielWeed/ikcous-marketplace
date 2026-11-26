-- ============================================================================
-- Migration 20261560000000 - o infinito nao entra no banco
-- (fecha o "+Infinity fica para outra frente" da 20261400000000, secao 4: taxa de entrega local, preco proprio da variacao e
-- valor do cupom)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- Desde o Postgres 14, numeric SEM precisao aceita 'Infinity' e '-Infinity'. As restricoes da 20261400000000 (`col >= 0 AND
-- col <> 'NaN'`) deixam o +Infinity passar: `'Infinity' >= 0` e' verdadeiro e `'Infinity' <> 'NaN'` tambem. Tres das quatro
-- colunas de dinheiro dela sao numeric SEM precisao, e o pedido soma o que o banco guarda:
--   * store_config.local_delivery_fee: upsert_store_config grava (config_json->>'local_delivery_fee')::numeric sem guarda (a
--     string "Infinity" no JSON vira Infinity). Com a taxa infinita o total de todo pedido com entrega local vira Infinity e a
--     conferencia do total na RPC do pedido nunca bate: NENHUM pedido com entrega local fecha na loja.
--   * product_variants.price_override: salvar_produto_com_grade (e o PostgREST direto) so fazem o cast; a variacao com preco
--     infinito deixa de vender.
--   * coupons.value: o valor entra na conta do desconto; nao existe cupom de valor infinito legitimo.
-- '-Infinity' ja e' recusado pelo `>= 0` da 400 ONDE ELA ESTA APLICADA (ela se aplica a parte, loja por loja); aqui ele e'
-- recusado de novo, para a regra valer com ou sem a 400. As telas ja barram; o buraco e' a chamada direta da API ou da RPC por
-- uma conta de admin. Isto e' defesa de SERVIDOR; nenhum front muda.
--
-- produtos.preco_venda (a quarta coluna da 400) e' numeric(10,2): o proprio tipo recusa infinito ("numeric field overflow",
-- 22003) e ela NAO ganha restricao aqui; o pre-voo exige que ela continue com precisao (se perder, esta migration se recusa).
--
-- 2. O QUE MUDA (so objeto NOVO; nenhuma funcao, linha, permissao nem restricao existente e' tocada)
--
-- Tres restricoes CHECK NOVAS e SEPARADAS das da 400 (aquelas ficam como estao), criadas JA VALIDADAS (o ADD varre a tabela;
-- ver secao 3), na ordem store_config, product_variants, coupons:
--   store_config_local_delivery_fee_finito   CHECK (local_delivery_fee <> 'Infinity' AND local_delivery_fee <> '-Infinity')
--   product_variants_price_override_finito   CHECK (price_override IS NULL OR (price_override <> 'Infinity' AND price_override <> '-Infinity'))
--   coupons_value_finito                     CHECK (value <> 'Infinity' AND value <> '-Infinity')
-- A comparacao e' por VALOR numeric, entao toda grafia que o Postgres le como infinito ('inf', '+Infinity', '-INF') cai igual.
-- Todo valor finito continua valido. NaN passa por esta regra (`NaN <> 'Infinity'` e' verdadeiro) e continua barrado pela
-- restricao da 400. price_override NULL (herda o preco do produto) continua valido; o `IS NULL OR` e' redundante para o
-- Postgres (CHECK com NULL passa) e fica so para dizer a intencao, como na 400. A recusa vem do proprio INSERT/UPDATE, qualquer
-- que seja a porta (RLS do admin, RPC, service_role, sessao direta), e chega como 23514 com o nome da restricao.
--
-- 3. DADOS QUE JA EXISTIAM - A MIGRATION SE RECUSA A APLICAR SE HOUVER (leia antes de aplicar)
--
-- O mesmo raciocinio da 400 (secao 3 dela): um CHECK, mesmo NOT VALID, e' reavaliado em TODO UPDATE da linha, mesmo que a
-- coluna nao mude. Uma linha antiga INFINITA ficaria travada para UPDATE, e a expiracao de pedidos (expirar_pedidos_vencidos,
-- uma transacao so: devolver_estoque e a volta do uso do cupom) desfaria a cada rodada se um item dela estivesse num pedido
-- pendente. Por isso NAO ha NOT VALID aqui, e ha DUAS defesas, nesta ordem:
--   (a) A GUARDA, ANTES dos ADD: conta as linhas infinitas das tres colunas (a mesma expressao das restricoes; NULL nao conta)
--       e, se houver alguma, ABORTA com B1_BASELINE_DIVERGENT dizendo QUAL coluna e QUANTAS linhas. Roda em toda execucao.
--   (b) O PROPRIO ADD CONSTRAINT, VALIDADO: varre a tabela trancada (ACCESS EXCLUSIVE) e recusa (23514) a linha que outra sessao
--       gravou e confirmou depois da foto REPEATABLE READ do aplicador (a guarda le a foto e nao a ve).
-- Nos dois casos a transacao inteira desfaz: nenhuma restricao fica, nenhuma linha muda. Nesse caso NAO aplicar nessa loja antes
-- de corrigir o valor dessas linhas (decisao da lojista: so ela sabe o valor certo; esta migration nao corrige nem apaga).
-- Medicao previa, so leitura, em cada loja (esperado: tudo 0):
--
--   SELECT
--     (SELECT count(*) FROM public.store_config WHERE NOT (local_delivery_fee <> 'Infinity'::numeric AND local_delivery_fee <> '-Infinity'::numeric)) AS taxa,
--     (SELECT count(*) FROM public.product_variants WHERE NOT (price_override IS NULL OR (price_override <> 'Infinity'::numeric AND price_override <> '-Infinity'::numeric))) AS price_override,
--     (SELECT count(*) FROM public.coupons WHERE NOT (value <> 'Infinity'::numeric AND value <> '-Infinity'::numeric)) AS cupom;
--
-- Custo: a guarda varre as tres tabelas (pequenas numa loja) so com trava de leitura; cada ADD varre a sua com a tabela
-- trancada por um instante, dentro do statement_timeout de 30 s.
--
-- 4. FORA DO ESCOPO (conferido, nao tocado)
--   * As quatro restricoes da 400 (`*_nao_negativo`): nem lidas para mudar, nem apagadas, nem recriadas.
--   * NaN: ja e' da 400. produtos.preco_venda: numeric(10,2), o tipo ja recusa infinito (secao 1).
--   * store_config.free_shipping_min e as demais colunas numericas: fora da lista da 400, outra frente.
--   * Nenhuma funcao, politica, gatilho, GRANT ou front muda; nenhuma tabela nova.
--
-- 5. PRE-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita; a guarda da secao 3 e' a 2a recusa, tambem ANTES dos ADD)
--
-- As tres colunas tem de existir como numeric; produtos.preco_venda tem de existir como numeric COM precisao (atttypmod <> -1);
-- cada restricao nova, se ja existir, tem de ser exatamente a desenhada (validada; NOT VALID tambem e' aceita para nao recusar
-- quem a criou assim a mao). Estados aceitos por restricao: ausente (cria) ou como desenhada (reaplicar e' no-op).
--
-- 6. TRANSACAO, IDEMPOTENCIA E TRAVA
--
-- Sem BEGIN/COMMIT de nivel superior neste arquivo (AGENTS.md: "Migration nao leva BEGIN/COMMIT"; com eles o ROLLBACK da prova
-- vira no-op e a mudanca fica gravada): o aplicador (db-apply.cjs, aplicar-migrations.yml, o job do rpc-ci) abre UMA transacao
-- para o arquivo inteiro, entao pre-voo, guarda, as tres restricoes e a conferencia caem juntas ou nao caem. Cada restricao so
-- e' criada se ainda nao existe: rodar duas vezes deixa o mesmo estado (mesmo OID). Com lock_timeout = 5s, loja com gravacao em
-- voo falha LIMPO em vez de travar a compra - repetir depois. As travas sao pedidas na ordem em que a compra online as pega
-- (store_config, variacoes, cupons), para a migration nao cruzar com ela (inversao de ordem seria deadlock).
--
-- 7. ORDEM E ROLLBACK
--
-- Nenhuma dependencia de outra migration alem das tres tabelas (vale com ou sem a 400 aplicada). Banco antes ou depois do front
-- da no mesmo.
-- ROLLBACK MANUAL: rollback-manual-20261560000000_o_infinito_nao_entra_no_banco.sql tira as tres restricoes NOVAS (os unicos
-- objetos criados aqui); nenhuma linha muda e as da 400 ficam. Com ele volta o defeito.
--
-- 8. PROVA VIVA: tests/banco/o-infinito-nao-entra-no-banco-viva.cjs (rpc-ci, Postgres efemero; nao prova lojas reais nem o
-- PostgREST). Conferencia por loja: 193b antes e 193a depois (conferir-banco-da-loja.yml).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261560000000$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('store_config', 'local_delivery_fee', 'store_config_local_delivery_fee_finito',
     'CHECK (((local_delivery_fee <> ''Infinity''::numeric) AND (local_delivery_fee <> ''-Infinity''::numeric)))'),
    ('product_variants', 'price_override', 'product_variants_price_override_finito',
     'CHECK (((price_override IS NULL) OR ((price_override <> ''Infinity''::numeric) AND (price_override <> ''-Infinity''::numeric))))'),
    ('coupons', 'value', 'coupons_value_finito',
     'CHECK (((value <> ''Infinity''::numeric) AND (value <> ''-Infinity''::numeric)))')
  ) AS esperado(tabela, coluna, restricao, definicao)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || r.tabela)
                      AND a.attname = r.coluna AND a.atttypid = 'numeric'::regtype AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.%.% (numeric) nao existe - meca a loja e revise antes de aplicar.', r.tabela, r.coluna;
    END IF;
    SELECT pg_get_constraintdef(c.oid) INTO v_def
      FROM pg_constraint c
     WHERE c.conrelid = to_regclass('public.' || r.tabela) AND c.conname = r.restricao;
    IF FOUND AND v_def NOT IN (r.definicao || ' NOT VALID', r.definicao) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % ja existe em public.% com outra regra (%) - revise antes de aplicar.', r.restricao, r.tabela, v_def;
    END IF;
  END LOOP;
  -- produtos.preco_venda fica de fora porque o TIPO (numeric com precisao) ja recusa infinito; se a loja a tiver sem precisao,
  -- ela aceitaria infinito e precisaria da propria restricao: recusar e revisar, nunca deixar o buraco calado.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = to_regclass('public.produtos')
                    AND a.attname = 'preco_venda' AND a.atttypid = 'numeric'::regtype AND a.atttypmod <> -1
                    AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.produtos.preco_venda nao e numeric com precisao (aceitaria Infinity e esta migration nao a cobre) - meca a loja e revise antes de aplicar.';
  END IF;
END $preflight_20261560000000$;

-- A GUARDA (cabecalho, secao 3a): com as restricoes ativas, linha antiga INFINITA trava qualquer UPDATE dela. Mesma expressao das
-- restricoes; NULL nao conta (nao e' ruim). Le a foto da transacao: linha gravada entre a foto e a trava (REPEATABLE READ do
-- aplicador) e' pega pelo ADD validado logo abaixo (secao 3b), nao por esta contagem.
DO $guarda_20261560000000$
DECLARE
  v_taxa bigint;
  v_variacao bigint;
  v_cupom bigint;
  v_ruins text;
BEGIN
  SELECT count(*) INTO v_taxa FROM public.store_config WHERE NOT (local_delivery_fee <> 'Infinity'::numeric AND local_delivery_fee <> '-Infinity'::numeric);
  SELECT count(*) INTO v_variacao FROM public.product_variants WHERE NOT (price_override IS NULL OR (price_override <> 'Infinity'::numeric AND price_override <> '-Infinity'::numeric));
  SELECT count(*) INTO v_cupom FROM public.coupons WHERE NOT (value <> 'Infinity'::numeric AND value <> '-Infinity'::numeric);
  IF v_taxa + v_variacao + v_cupom > 0 THEN
    SELECT string_agg(x.rotulo || ' (' || x.n || ' linha(s))', ', ' ORDER BY x.ordem) INTO v_ruins
      FROM (VALUES (1, 'store_config.local_delivery_fee', v_taxa),
                   (2, 'product_variants.price_override', v_variacao),
                   (3, 'coupons.value', v_cupom)) AS x(ordem, rotulo, n)
     WHERE x.n > 0;
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ha valor infinito (Infinity ou -Infinity) que ja existia em: % - a migration NAO foi aplicada (a transacao desfaz tudo e nenhuma restricao fica). Com a restricao ativa cada uma dessas linhas travaria qualquer UPDATE dela, inclusive a devolucao de estoque e do uso do cupom feitas pela expiracao de pedidos vencidos: UM item assim impediria a varredura inteira de expirar QUALQUER pedido da loja. Corrija o valor dessas linhas (decisao da lojista: so ela sabe o valor certo) e aplique de novo.', v_ruins;
  END IF;
END $guarda_20261560000000$;

-- As tres restricoes, JA VALIDADAS (sem NOT VALID, de proposito): o ADD varre a tabela com ela trancada e recusa (23514) se
-- houver linha infinita, inclusive a que a guarda nao viu por causa da foto do REPEATABLE READ (cabecalho, secao 3b).
DO $restricoes_20261560000000$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.store_config'::regclass AND c.conname = 'store_config_local_delivery_fee_finito') THEN
    ALTER TABLE public.store_config ADD CONSTRAINT store_config_local_delivery_fee_finito CHECK (local_delivery_fee <> 'Infinity'::numeric AND local_delivery_fee <> '-Infinity'::numeric);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.product_variants'::regclass AND c.conname = 'product_variants_price_override_finito') THEN
    ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_price_override_finito CHECK (price_override IS NULL OR (price_override <> 'Infinity'::numeric AND price_override <> '-Infinity'::numeric));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.coupons'::regclass AND c.conname = 'coupons_value_finito') THEN
    ALTER TABLE public.coupons ADD CONSTRAINT coupons_value_finito CHECK (value <> 'Infinity'::numeric AND value <> '-Infinity'::numeric);
  END IF;
END $restricoes_20261560000000$;

-- CONFERENCIA no instante do apply: as tres existem, na tabela certa, com a regra desenhada.
DO $conferencia_20261560000000$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('store_config', 'store_config_local_delivery_fee_finito',
     'CHECK (((local_delivery_fee <> ''Infinity''::numeric) AND (local_delivery_fee <> ''-Infinity''::numeric)))'),
    ('product_variants', 'product_variants_price_override_finito',
     'CHECK (((price_override IS NULL) OR ((price_override <> ''Infinity''::numeric) AND (price_override <> ''-Infinity''::numeric))))'),
    ('coupons', 'coupons_value_finito',
     'CHECK (((value <> ''Infinity''::numeric) AND (value <> ''-Infinity''::numeric)))')
  ) AS esperado(tabela, restricao, definicao)
  LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conrelid = to_regclass('public.' || r.tabela) AND c.conname = r.restricao AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) IN (r.definicao || ' NOT VALID', r.definicao)
       ) THEN
      RAISE EXCEPTION 'conferencia 20261560000000: % em public.% nao ficou como desenhada', r.restricao, r.tabela;
    END IF;
  END LOOP;
END $conferencia_20261560000000$;
