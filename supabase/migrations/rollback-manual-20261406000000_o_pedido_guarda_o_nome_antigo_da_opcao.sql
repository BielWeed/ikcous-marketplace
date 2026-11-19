-- Rollback manual da 20261406000000. Nenhuma função anterior foi modificada.
-- Mantém as colunas para não apagar o histórico gravado e para continuar atendendo o front.
-- O aplicador abre a transação e controla o ledger.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_rollback$
BEGIN
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
END $preflight_rollback$;

DROP TRIGGER IF EXISTS tr_product_variants_guarda_rotulo_no_pedido ON public.product_variants;
DROP FUNCTION IF EXISTS public.guardar_rotulo_da_opcao_no_pedido();

NOTIFY pgrst, 'reload schema';
