-- ============================================================================
-- Rollback manual - o infinito nao entra no banco (20261560000000)
-- ============================================================================
-- Tira as tres restricoes CHECK que a 20261560000000 criou, os UNICOS objetos dela (nao ha estado anterior a restaurar):
--   store_config_local_delivery_fee_finito, product_variants_price_override_finito, coupons_value_finito.
-- As quatro restricoes da 20261400000000 (`*_nao_negativo`) NAO sao tocadas. Nenhuma linha de nenhuma tabela e' lida ou
-- reescrita; o que foi gravado enquanto elas existiam fica como esta.
--
-- COM ELE VOLTA O DEFEITO: o banco volta a aceitar taxa de entrega local, preco de variacao e valor de cupom INFINITOS por
-- chamada direta da API ou da RPC (e, onde a 400 nao esta aplicada, -Infinity tambem). Tambem e' o conserto de emergencia se
-- uma restricao passou a recusar o UPDATE de uma linha (venda, edicao, uso do cupom, salvar configuracao) - mas o certo e'
-- corrigir o valor da linha, nao tirar a trava.
--
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) ANTES de apagar qualquer uma se alguma das tres existir mas NAO for a desenhada
-- (alguem a redefiniu: apagar levaria junto uma regra que ninguem revisou). Estados aceitos por restricao: como desenhada
-- (NOT VALID ou ja validada) ou ausente (rodar de novo e' no-op). Conferencia final: nenhuma das tres existe.
--
-- Executar pelo aplicar-migrations.yml (apaga o registro do ledger na mesma transacao). Sem BEGIN/COMMIT de nivel superior
-- neste arquivo (AGENTS.md); o aplicador da a transacao. Rodar duas vezes deixa o mesmo estado.
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_20261560000000$
DECLARE
  r record;
  v_def text;
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
    SELECT pg_get_constraintdef(c.oid) INTO v_def
      FROM pg_constraint c
     WHERE c.conrelid = to_regclass('public.' || r.tabela) AND c.conname = r.restricao;
    IF FOUND AND v_def NOT IN (r.definicao || ' NOT VALID', r.definicao) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % (%) nao e a da 20261560000000 - revise antes de apagar.', r.restricao, v_def;
    END IF;
  END LOOP;
END $preflight_rollback_20261560000000$;

ALTER TABLE public.store_config DROP CONSTRAINT IF EXISTS store_config_local_delivery_fee_finito;
ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_price_override_finito;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_value_finito;

DO $conferencia_rollback_20261560000000$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conname IN ('store_config_local_delivery_fee_finito',
                                  'product_variants_price_override_finito',
                                  'coupons_value_finito')
                AND c.conrelid IN ('public.store_config'::regclass, 'public.product_variants'::regclass,
                                   'public.coupons'::regclass)) THEN
    RAISE EXCEPTION 'conferencia rollback 20261560000000: ainda existe restricao de valor infinito';
  END IF;
END $conferencia_rollback_20261560000000$;
