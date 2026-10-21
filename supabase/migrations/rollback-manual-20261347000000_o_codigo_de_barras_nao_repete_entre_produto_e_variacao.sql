-- ============================================================================
-- Rollback manual - 20261347000000 (o codigo de barras nao repete entre produto e variacao)
-- ============================================================================
-- Remove os 2 gatilhos e as 2 funcoes, todos NOVOS na migration; nao ha corpo antigo a restaurar.
-- COM ELE VOLTA O DEFEITO: o mesmo codigo de barras pode ser gravado num produto e na variacao de outro.
--
-- DADOS: nenhuma linha de produtos nem de product_variants e lida ou reescrita. Codigos gravados enquanto o
-- gatilho existiu continuam como estao (nao ha duplicata entre as tabelas entre eles); duplicatas anteriores
-- a migration tambem continuam como estavam. Nenhum indice, coluna, policy ou permissao e tocado.
--
-- PRE-VOO: recusa (B1_BASELINE_DIVERGENT) antes de apagar qualquer coisa se uma funcao existir com corpo
-- diferente do da migration (alguem a redefiniu: apagar levaria junto uma redefinicao que ninguem revisou),
-- se houver sobrecarga, ou se um gatilho com esses nomes NAO for o desenhado (outra tabela, outra funcao,
-- outra coluna, outro momento/evento, WHEN, argumentos). Estados aceitos: tudo como desenhado, so as funcoes
-- (gatilhos ja tirados) ou nada (rodar de novo e' no-op). Conferencia final: nenhum dos 4 objetos existe.
--
-- Executar pelo aplicar-migrations.yml (a transacao e o ledger sao do aplicador). Sem BEGIN/COMMIT neste
-- arquivo (regra da casa). Rodar duas vezes deixa o mesmo estado. Termina recarregando o esquema do PostgREST.
-- ============================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback_347$
DECLARE
  v_fn_produto oid := to_regprocedure('public.produto_codigo_barras_livre_de_variacao()');
  v_fn_variacao oid := to_regprocedure('public.variacao_codigo_barras_livre_de_produto()');
  v_hash text;
  v_gat record;
BEGIN
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('produto_codigo_barras_livre_de_variacao', 'variacao_codigo_barras_livre_de_produto')) >
     (CASE WHEN v_fn_produto IS NULL THEN 0 ELSE 1 END + CASE WHEN v_fn_variacao IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: as funcoes do gatilho de codigo de barras existem em public com outra assinatura ou sobrecarga; revise antes de apagar.';
  END IF;
  IF v_fn_produto IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_fn_produto;
    IF v_hash IS DISTINCT FROM '8aa103a09d8dbd0a9d034fbe25892687' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.produto_codigo_barras_livre_de_variacao() (hash %) nao e o da 20261347000000; uma redefinicao posterior esta no ar, revise antes de apagar.', COALESCE(v_hash, 'ausente');
    END IF;
  END IF;
  IF v_fn_variacao IS NOT NULL THEN
    SELECT md5(replace(prosrc, E'\r', '')) INTO v_hash FROM pg_proc WHERE oid = v_fn_variacao;
    IF v_hash IS DISTINCT FROM '8b2b01facae896b432629e275e4df664' THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de public.variacao_codigo_barras_livre_de_produto() (hash %) nao e o da 20261347000000; uma redefinicao posterior esta no ar, revise antes de apagar.', COALESCE(v_hash, 'ausente');
    END IF;
  END IF;

  FOR v_gat IN
    SELECT t.tgname, t.tgrelid, t.tgfoid, t.tgtype, t.tgqual IS NOT NULL AS tem_when, t.tgnargs,
           t.tgattr::text AS attr, t.tgisinternal
      FROM pg_trigger t
     WHERE t.tgname IN ('tr_produto_codigo_barras_livre_de_variacao', 'tr_variacao_codigo_barras_livre_de_produto')
  LOOP
    IF v_gat.tgname = 'tr_produto_codigo_barras_livre_de_variacao' THEN
      IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.produtos')
         OR v_gat.tgfoid IS DISTINCT FROM v_fn_produto
         OR v_gat.attr IS DISTINCT FROM (SELECT attnum::text FROM pg_attribute WHERE attrelid = to_regclass('public.produtos') AND attname = 'codigo_barras' AND NOT attisdropped) THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: tr_produto_codigo_barras_livre_de_variacao existe mas NAO e o desenhado pela 20261347000000; revise antes de apagar.';
      END IF;
    ELSE
      IF v_gat.tgrelid IS DISTINCT FROM to_regclass('public.product_variants')
         OR v_gat.tgfoid IS DISTINCT FROM v_fn_variacao
         OR v_gat.attr IS DISTINCT FROM (SELECT attnum::text FROM pg_attribute WHERE attrelid = to_regclass('public.product_variants') AND attname = 'codigo_barras' AND NOT attisdropped) THEN
        RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: tr_variacao_codigo_barras_livre_de_produto existe mas NAO e o desenhado pela 20261347000000; revise antes de apagar.';
      END IF;
    END IF;
    IF v_gat.tgtype <> 23 OR v_gat.tem_when OR v_gat.tgnargs <> 0 OR v_gat.tgisinternal THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: o gatilho % existe com outro momento, evento, WHEN ou argumentos; revise antes de apagar.', v_gat.tgname;
    END IF;
  END LOOP;
END $preflight_rollback_347$;

DROP TRIGGER IF EXISTS tr_produto_codigo_barras_livre_de_variacao ON public.produtos;
DROP TRIGGER IF EXISTS tr_variacao_codigo_barras_livre_de_produto ON public.product_variants;

DROP FUNCTION IF EXISTS public.produto_codigo_barras_livre_de_variacao();
DROP FUNCTION IF EXISTS public.variacao_codigo_barras_livre_de_produto();

DO $conferencia_rollback_347$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname IN ('tr_produto_codigo_barras_livre_de_variacao', 'tr_variacao_codigo_barras_livre_de_produto')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261347: um dos gatilhos ainda existe';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('produto_codigo_barras_livre_de_variacao', 'variacao_codigo_barras_livre_de_produto')) THEN
    RAISE EXCEPTION 'conferencia rollback 20261347: uma das funcoes ainda existe';
  END IF;
END $conferencia_rollback_347$;

NOTIFY pgrst, 'reload schema';
