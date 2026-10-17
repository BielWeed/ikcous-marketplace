-- ROLLBACK DESTRUTIVO 20261247000000 — SÓ COM O DONO.
-- Apaga a tabela marketplace_order_internal_notes com TODAS as anotações internas dos pedidos e a função do carimbo.
-- Não há cópia: faça um backup das linhas antes. O rollback comum preserva esses dados.
-- Só depois do rollback comum (a porta já fechada), numa transação do caller, com confirmação:
-- SET app.confirmo_apagar_notas_internas = 'APAGAR';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $destrutivo_20261247$
DECLARE
  v_t oid := to_regclass('public.marketplace_order_internal_notes');
  v_n bigint;
BEGIN
  IF COALESCE(current_setting('app.confirmo_apagar_notas_internas', true), '') <> 'APAGAR' THEN
    RAISE EXCEPTION 'NOTAS_INTERNAS_SO_COM_O_DONO: confirme antes de apagar as anotações internas.';
  END IF;
  IF v_t IS NOT NULL AND NOT (
       NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t)
       AND NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = v_t AND g.grantee <> c.relowner)
     ) THEN
    RAISE EXCEPTION 'NOTAS_INTERNAS_ROLLBACK_COMUM_PRIMEIRO: feche a porta (rollback comum) antes de apagar a tabela.';
  END IF;
  IF v_t IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.marketplace_order_internal_notes' INTO v_n;
    RAISE NOTICE 'apagando % anotação(ões) interna(s)', v_n;
  END IF;
END $destrutivo_20261247$;

DROP TABLE IF EXISTS public.marketplace_order_internal_notes;
DROP FUNCTION IF EXISTS public.carimba_nota_interna_do_pedido();
