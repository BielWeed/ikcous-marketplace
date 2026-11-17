-- ============================================================================
-- Migration 20261400000000 - valores negativos nao entram no banco
-- (caca estatica de 17/11/2026: taxa de entrega local, preco do produto, preco proprio da variacao e valor do cupom)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- Quatro colunas de dinheiro aceitam valor NEGATIVO, e o pedido soma o que o banco guarda:
--   * store_config.local_delivery_fee: upsert_store_config grava (config_json->>'local_delivery_fee')::numeric sem guarda,
--     e create_marketplace_order_v23/_v24 cobram COALESCE(local_delivery_fee, 0) no total
--     (GREATEST(0, subtotal + frete - desconto)). Taxa de -50 num pedido de R$100 cobra R$50.
--   * produtos.preco_venda e product_variants.price_override: salvar_produto_com_grade (e o PostgREST direto) so fazem o
--     cast, e a compra so confere preco NAO NULO. Um produto de -90 abate o total dos outros produtos do mesmo pedido.
--   * coupons.value: validate_coupon_secure_v2 e o pedido tratam o valor como desconto; `fixed` de -20 devolve
--     discount_value -20 (is_valid true) e o total SOBE R$20 em vez de cair.
-- NaN tambem entra nas quatro (o Postgres ordena NaN ACIMA de todo numero: `NaN >= 0` e verdadeiro) e envenena o total.
-- As telas ja barram (taxa local, preco do produto e da variacao, valor do cupom nao aceitam negativo); o buraco e' a chamada
-- direta da API ou da RPC por uma conta de admin. Isto e' defesa de SERVIDOR; nenhum front muda.
--
-- 2. O QUE MUDA (so objeto NOVO; nenhuma funcao, linha ou permissao e' tocada)
--
-- Quatro restricoes CHECK, criadas NOT VALID, na ordem store_config, product_variants, produtos, coupons:
--   store_config_local_delivery_fee_nao_negativo   CHECK (local_delivery_fee >= 0 AND local_delivery_fee <> 'NaN')
--   product_variants_price_override_nao_negativo   CHECK (price_override IS NULL OR (price_override >= 0 AND price_override <> 'NaN'))
--   produtos_preco_venda_nao_negativo              CHECK (preco_venda >= 0 AND preco_venda <> 'NaN')
--   coupons_value_nao_negativo                     CHECK (value >= 0 AND value <> 'NaN')
-- ZERO continua valido (brinde, retirada/entrega gratis, cupom de valor zero). price_override NULL (herda o preco do
-- produto) continua valido; o `IS NULL OR` e' redundante para o Postgres (CHECK com NULL passa) e fica so para dizer a intencao.
-- Nenhum corpo de funcao muda (os corpos tem hash pinado): a recusa vem do proprio INSERT/UPDATE, qualquer que seja a porta
-- (RLS do admin, RPC, service_role, sessao direta), e chega como 23514 com o nome da restricao.
--
-- 3. DADOS QUE JA EXISTIAM - A MIGRATION SE RECUSA A APLICAR SE HOUVER (leia antes de aplicar)
--
-- NOT VALID so dispensa a conferencia das linhas existentes NO MOMENTO do ADD. O Postgres reavalia o CHECK em TODO INSERT e em
-- TODO UPDATE da linha, mesmo que a coluna nao mude. Logo, uma linha antiga NEGATIVA (ou NaN; so nasce por chamada direta, as
-- telas barram) ficaria "travada para UPDATE" ate alguem corrigi-la - e o pior caso e' a EXPIRACAO DE PEDIDOS:
--   * expirar_pedidos_vencidos (20261393000000) percorre os pedidos pendentes vencidos NUMA transacao so e, para cada um, chama
--     devolver_estoque (UPDATE em produtos/product_variants) e devolve o uso do cupom (UPDATE em coupons), sem tratamento de
--     erro por pedido. UM produto, variacao ou cupom negativo num pedido pendente faria a varredura inteira desfazer a cada
--     rodada do agendador: NENHUM pedido da loja expiraria mais e o estoque de todos ficaria preso;
--   * produto com preco negativo: nao se vende (a baixa de estoque da compra e' um UPDATE) nem se edita outro campo, e, pelo
--     gatilho sync_produto_ultima_atualizacao, tambem nao se edita/estoca nenhuma VARIACAO dele; variacao com price_override
--     negativo: idem; cupom negativo: nao se usa (usage_count e' um UPDATE); taxa local negativa: qualquer salvamento da
--     configuracao da loja recusa.
--
-- Por isso a migration TEM UMA GUARDA (mesmo padrao da 20261396200000): logo depois dos quatro ADD CONSTRAINT (as tabelas ja
-- estao trancadas, entao nenhuma linha nova entra no meio), conta as linhas ruins das quatro colunas (a mesma expressao das
-- restricoes; NULL e zero nao contam; a sentinela -1 de free_shipping_min e' outra coluna e nao entra) e, se houver alguma,
-- ABORTA com B1_BASELINE_DIVERGENT dizendo QUAL coluna e QUANTAS linhas. A transacao inteira desfaz: nenhuma restricao fica,
-- nenhuma linha muda. Nesse caso NAO aplicar nessa loja antes de corrigir o valor dessas linhas (decisao da lojista: so ela
-- sabe o valor certo; esta migration nao corrige nem apaga). Corrigido o dado, aplicar de novo. A guarda roda em TODA execucao,
-- tambem na reaplicacao (loja limpa: no-op). Medicao previa, so leitura, em cada loja (esperado: tudo 0):
--
--   SELECT
--     (SELECT count(*) FROM public.store_config WHERE NOT (local_delivery_fee >= 0 AND local_delivery_fee <> 'NaN'::numeric)) AS taxa,
--     (SELECT count(*) FROM public.produtos WHERE NOT (preco_venda >= 0 AND preco_venda <> 'NaN'::numeric)) AS preco_venda,
--     (SELECT count(*) FROM public.product_variants WHERE NOT (price_override IS NULL OR (price_override >= 0 AND price_override <> 'NaN'::numeric))) AS price_override,
--     (SELECT count(*) FROM public.coupons WHERE NOT (value >= 0 AND value <> 'NaN'::numeric)) AS cupom;
--
-- Custo da guarda: uma varredura de cada uma das quatro tabelas (pequenas numa loja), com as tabelas trancadas, dentro do
-- statement_timeout de 30 s. O VALIDATE CONSTRAINT fica de fora de proposito: esta migration nao o roda.
--
-- 4. FORA DO ESCOPO (conferido, nao tocado)
--   * store_config.free_shipping_min: a sentinela legada NEGATIVA (por produto, -1) e' intencional e nao ganha restricao.
--   * +Infinity: numeric sem precisao aceita Infinity e `Infinity >= 0` e' verdadeiro; nao e' "negativo" e fica para outra frente.
--   * cupom percentual acima de 100: outra frente (a tela barra e o servidor limita o desconto ao subtotal).
--   * Nenhuma funcao, politica, gatilho, GRANT ou front muda; nenhuma tabela nova.
--
-- 5. PRE-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita; a guarda da secao 3 e' a 2a recusa, DEPOIS dos ADD e desfeita junto)
--
-- As quatro colunas tem de existir como numeric; cada restricao, se ja existir, tem de ser exatamente a desenhada (NOT VALID
-- ou ja validada). Estados aceitos por restricao: ausente (cria) ou como desenhada (reaplicar e' no-op).
--
-- 6. TRANSACAO, IDEMPOTENCIA E TRAVA
--
-- Sem BEGIN/COMMIT de nivel superior neste arquivo (AGENTS.md: "Migration nao leva BEGIN/COMMIT"; com eles o ROLLBACK da prova
-- vira no-op e a mudanca fica gravada): o aplicador (db-apply.cjs, aplicar-migrations.yml, o job do rpc-ci) abre UMA transacao
-- para o arquivo inteiro, entao pre-voo, as quatro restricoes, a guarda e a conferencia caem juntas ou nao caem (provado numa conexao
-- SEM BEGIN: falha na 3a restricao, a guarda recusando ou a conferencia deixa NENHUMA das quatro). Cada restricao so e' criada se ainda nao
-- existe: rodar duas vezes deixa o mesmo estado (mesmo OID); restricao ja validada a mao tambem e' aceita.
-- ADD CONSTRAINT ... CHECK tranca a tabela (ACCESS EXCLUSIVE) por um instante, sem varrer (NOT VALID). Com lock_timeout = 5s,
-- loja com gravacao em voo falha LIMPO em vez de travar a compra - repetir depois. As travas sao pedidas na ordem em que a
-- compra online as pega (store_config, variacoes, produtos, cupons), para a migration nao cruzar com ela (inversao de ordem
-- entre a migration e uma compra seria deadlock).
--
-- 7. ORDEM E ROLLBACK
--
-- Nenhuma dependencia de outra migration alem das quatro tabelas. Banco antes ou depois do front da no mesmo.
-- ROLLBACK MANUAL: rollback-manual-20261400000000_valores_negativos_nao_entram_no_banco.sql tira as quatro restricoes (os
-- unicos objetos criados aqui); nenhuma linha muda. Com ele volta o defeito.
--
-- 8. PROVA VIVA: tests/banco/valores-negativos-prova.cjs (rpc-ci, Postgres efemero; nao prova lojas reais nem o PostgREST).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261400000000$
DECLARE
  r record;
  v_def text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('store_config', 'local_delivery_fee', 'store_config_local_delivery_fee_nao_negativo',
     'CHECK (((local_delivery_fee >= (0)::numeric) AND (local_delivery_fee <> ''NaN''::numeric)))'),
    ('product_variants', 'price_override', 'product_variants_price_override_nao_negativo',
     'CHECK (((price_override IS NULL) OR ((price_override >= (0)::numeric) AND (price_override <> ''NaN''::numeric))))'),
    ('produtos', 'preco_venda', 'produtos_preco_venda_nao_negativo',
     'CHECK (((preco_venda >= (0)::numeric) AND (preco_venda <> ''NaN''::numeric)))'),
    ('coupons', 'value', 'coupons_value_nao_negativo',
     'CHECK (((value >= (0)::numeric) AND (value <> ''NaN''::numeric)))')
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
END $preflight_20261400000000$;

-- As quatro restricoes, NOT VALID: valem para todo INSERT/UPDATE a partir daqui e nao reprovam (nem leem) as linhas antigas.
DO $restricoes_20261400000000$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.store_config'::regclass
                  AND c.conname = 'store_config_local_delivery_fee_nao_negativo') THEN
    ALTER TABLE public.store_config ADD CONSTRAINT store_config_local_delivery_fee_nao_negativo CHECK (local_delivery_fee >= 0 AND local_delivery_fee <> 'NaN'::numeric) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.product_variants'::regclass
                  AND c.conname = 'product_variants_price_override_nao_negativo') THEN
    ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_price_override_nao_negativo CHECK (price_override IS NULL OR (price_override >= 0 AND price_override <> 'NaN'::numeric)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.produtos'::regclass
                  AND c.conname = 'produtos_preco_venda_nao_negativo') THEN
    ALTER TABLE public.produtos ADD CONSTRAINT produtos_preco_venda_nao_negativo CHECK (preco_venda >= 0 AND preco_venda <> 'NaN'::numeric) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.coupons'::regclass
                  AND c.conname = 'coupons_value_nao_negativo') THEN
    ALTER TABLE public.coupons ADD CONSTRAINT coupons_value_nao_negativo CHECK (value >= 0 AND value <> 'NaN'::numeric) NOT VALID;
  END IF;
END $restricoes_20261400000000$;

-- A GUARDA (cabecalho, secao 3): com as restricoes ativas, linha antiga NEGATIVA (ou NaN) trava qualquer UPDATE dela. As quatro
-- tabelas ja foram trancadas pelos ADD CONSTRAINT acima (a trava dura ate o fim da transacao), entao nenhuma linha nova entra
-- entre esta contagem e o fim. Mesma expressao das restricoes: NOT (col >= 0 AND col <> 'NaN'); NULL nao conta (nao e' ruim).
DO $guarda_20261400000000$
DECLARE
  v_taxa bigint;
  v_variacao bigint;
  v_preco bigint;
  v_cupom bigint;
  v_ruins text;
BEGIN
  SELECT count(*) INTO v_taxa FROM public.store_config WHERE NOT (local_delivery_fee >= 0 AND local_delivery_fee <> 'NaN'::numeric);
  SELECT count(*) INTO v_variacao FROM public.product_variants WHERE NOT (price_override IS NULL OR (price_override >= 0 AND price_override <> 'NaN'::numeric));
  SELECT count(*) INTO v_preco FROM public.produtos WHERE NOT (preco_venda >= 0 AND preco_venda <> 'NaN'::numeric);
  SELECT count(*) INTO v_cupom FROM public.coupons WHERE NOT (value >= 0 AND value <> 'NaN'::numeric);
  IF v_taxa + v_variacao + v_preco + v_cupom > 0 THEN
    SELECT string_agg(x.rotulo || ' (' || x.n || ' linha(s))', ', ' ORDER BY x.ordem) INTO v_ruins
      FROM (VALUES (1, 'store_config.local_delivery_fee', v_taxa),
                   (2, 'product_variants.price_override', v_variacao),
                   (3, 'produtos.preco_venda', v_preco),
                   (4, 'coupons.value', v_cupom)) AS x(ordem, rotulo, n)
     WHERE x.n > 0;
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: ha valor negativo ou NaN que ja existia em: % - a migration NAO foi aplicada (a transacao desfaz tudo e nenhuma restricao fica). Com a restricao ativa cada uma dessas linhas travaria qualquer UPDATE dela, inclusive a baixa e a devolucao de estoque e do uso do cupom feitas pela expiracao de pedidos vencidos: UM item assim impediria a varredura inteira de expirar QUALQUER pedido da loja. Corrija o valor dessas linhas (decisao da lojista: so ela sabe o valor certo) e aplique de novo.', v_ruins;
  END IF;
END $guarda_20261400000000$;

-- CONFERENCIA no instante do apply: as quatro existem, na tabela certa, com a regra desenhada.
DO $conferencia_20261400000000$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('store_config', 'store_config_local_delivery_fee_nao_negativo',
     'CHECK (((local_delivery_fee >= (0)::numeric) AND (local_delivery_fee <> ''NaN''::numeric)))'),
    ('product_variants', 'product_variants_price_override_nao_negativo',
     'CHECK (((price_override IS NULL) OR ((price_override >= (0)::numeric) AND (price_override <> ''NaN''::numeric))))'),
    ('produtos', 'produtos_preco_venda_nao_negativo',
     'CHECK (((preco_venda >= (0)::numeric) AND (preco_venda <> ''NaN''::numeric)))'),
    ('coupons', 'coupons_value_nao_negativo',
     'CHECK (((value >= (0)::numeric) AND (value <> ''NaN''::numeric)))')
  ) AS esperado(tabela, restricao, definicao)
  LOOP
    IF NOT EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conrelid = to_regclass('public.' || r.tabela) AND c.conname = r.restricao AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) IN (r.definicao || ' NOT VALID', r.definicao)
       ) THEN
      RAISE EXCEPTION 'conferencia 20261400000000: % em public.% nao ficou como desenhada', r.restricao, r.tabela;
    END IF;
  END LOOP;
END $conferencia_20261400000000$;
