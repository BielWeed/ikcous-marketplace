-- Congela os dois textos da opção na primeira edição que o item do pedido vir.
-- Sem backfill nem mudança no checkout. O aplicador abre a transação e registra o ledger.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.product_variants', 'id', 'uuid'::regtype, true),
      ('public.product_variants', 'name', 'text'::regtype, true),
      ('public.product_variants', 'value', 'text'::regtype, true),
      ('public.marketplace_order_items', 'variant_id', 'uuid'::regtype, false)
    ) AS esperado(tabela, coluna, tipo, obrigatoria)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(esperado.tabela)
        AND a.attname = esperado.coluna AND NOT a.attisdropped
        AND a.atttypid = esperado.tipo AND a.attnotnull = esperado.obrigatoria
    )
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.marketplace_order_items')
      AND a.attname IN ('variacao_nome_na_compra', 'variacao_valor_na_compra')
      AND NOT a.attisdropped AND (a.atttypid <> 'text'::regtype OR a.attnotnull OR a.atthasdef)
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: colunas de variacao do pedido diferem da base esperada.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'guardar_rotulo_da_opcao_no_pedido'
      AND (p.oid IS DISTINCT FROM to_regprocedure('public.guardar_rotulo_da_opcao_no_pedido()')
           OR p.prorettype <> 'trigger'::regtype
           OR md5(replace(p.prosrc, E'\r', '')) <> '66e9a87eeb9e63fe6337daab90941cf7')
  ) OR EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = to_regclass('public.product_variants')
      AND t.tgname = 'tr_product_variants_guarda_rotulo_no_pedido'
      AND t.tgfoid IS DISTINCT FROM to_regprocedure('public.guardar_rotulo_da_opcao_no_pedido()')
  ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: gatilho ou funcao do rotulo tem definicao desconhecida.';
  END IF;
END $preflight$;

ALTER TABLE public.marketplace_order_items
  ADD COLUMN IF NOT EXISTS variacao_nome_na_compra text,
  ADD COLUMN IF NOT EXISTS variacao_valor_na_compra text;

-- O índice idx_marketplace_order_items_variant_id cobre a busca por opção.
-- Uma falha ao copiar vira aviso, sem conteúdo de cliente, e não recusa a edição.
CREATE OR REPLACE FUNCTION public.guardar_rotulo_da_opcao_no_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $guardar_rotulo$
BEGIN
  BEGIN
    UPDATE public.marketplace_order_items
       SET variacao_nome_na_compra = OLD.name,
           variacao_valor_na_compra = OLD.value
     WHERE variant_id = OLD.id
       AND variacao_nome_na_compra IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'guardar_rotulo_da_opcao_no_pedido: variacao % sem retrato (SQLSTATE %).', OLD.id, SQLSTATE;
  END;
  RETURN NULL;
END;
$guardar_rotulo$;

REVOKE ALL ON FUNCTION public.guardar_rotulo_da_opcao_no_pedido() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE TRIGGER tr_product_variants_guarda_rotulo_no_pedido
AFTER UPDATE OF name, value ON public.product_variants
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.value IS DISTINCT FROM NEW.value)
EXECUTE FUNCTION public.guardar_rotulo_da_opcao_no_pedido();

NOTIFY pgrst, 'reload schema';
