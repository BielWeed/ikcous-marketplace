-- ============================================================================
-- Rollback manual - valores negativos nao entram no banco (20261400000000)
-- ============================================================================
-- Tira as quatro restricoes CHECK que a 20261400000000 criou, os UNICOS objetos dela (nao ha estado anterior a restaurar):
--   store_config_local_delivery_fee_nao_negativo, product_variants_price_override_nao_negativo,
--   produtos_preco_venda_nao_negativo, coupons_value_nao_negativo.
-- Nenhuma linha de nenhuma tabela e' lida ou reescrita; o que foi gravado enquanto elas existiam fica como esta.
--
-- COM ELE VOLTA O DEFEITO: o banco volta a aceitar taxa de entrega, preco de produto, preco de variacao e valor de cupom
-- NEGATIVOS (e NaN) por chamada direta da API ou da RPC. Tambem e' o conserto de emergencia se uma loja tinha linha antiga
-- negativa e a restricao passou a recusar o UPDATE dela (venda do produto, edicao, uso do cupom, salvar configuracao): sem
-- a restricao esses UPDATEs voltam a funcionar - mas o certo e' corrigir o valor da linha, nao tirar a trava.
--
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) ANTES de apagar qualquer uma se alguma das quatro existir mas NAO for a desenhada
-- (alguem a redefiniu: apagar levaria junto uma regra que ninguem revisou). Estados aceitos por restricao: como desenhada
-- (NOT VALID ou ja validada) ou ausente (rodar de novo e' no-op). Conferencia final: nenhuma das quatro existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior
-- neste arquivo (AGENTS.md); o aplicador da a transacao. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261400000000$
DECLARE
  r record;
  v_def text;
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
    SELECT pg_get_constraintdef(c.oid) INTO v_def
      FROM pg_constraint c
     WHERE c.conrelid = to_regclass('public.' || r.tabela) AND c.conname = r.restricao;
    IF FOUND AND v_def NOT IN (r.definicao || ' NOT VALID', r.definicao) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (%) nao e a da 20261400000000 - revise antes de apagar.', r.restricao, v_def;
    END IF;
  END LOOP;
END $preflight_rollback_20261400000000$;

ALTER TABLE public.store_config DROP CONSTRAINT IF EXISTS store_config_local_delivery_fee_nao_negativo;
ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_price_override_nao_negativo;
ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS produtos_preco_venda_nao_negativo;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_value_nao_negativo;

DO $conferencia_rollback_20261400000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conname IN ('store_config_local_delivery_fee_nao_negativo',
                                  'product_variants_price_override_nao_negativo',
                                  'produtos_preco_venda_nao_negativo',
                                  'coupons_value_nao_negativo')
                AND c.conrelid IN ('public.store_config'::regclass, 'public.product_variants'::regclass,
                                   'public.produtos'::regclass, 'public.coupons'::regclass)) THEN
    RAISE EXCEPTION 'conferencia rollback 20261400000000: ainda existe restricao de valor negativo';
  END IF;
END $conferencia_rollback_20261400000000$;
