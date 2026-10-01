-- Rollback fechado das migrations 84/85. Rodar em UMA transação pelo workflow
-- rollback-pix-84-85.yml (ou psql -1), nunca como migration de ida.
-- Aceita 84+85 ou só 84; recusa uso, drift e execução repetida.
-- Nenhum pedido ou histórico é apagado.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.marketplace_orders IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.marketplace_order_history IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.marketplace_order_payment_history IN ACCESS EXCLUSIVE MODE;

DO $rollback$
DECLARE
  v_84 boolean;
  v_85 boolean;
BEGIN
  SELECT count(*) = 1 INTO v_84
    FROM supabase_migrations.schema_migrations
   WHERE version = '20261184000000' AND name = 'o_pix_do_balcao_abre_na_hora';
  SELECT count(*) = 1 INTO v_85
    FROM supabase_migrations.schema_migrations
   WHERE version = '20261185000000' AND name = 'a_venda_do_balcao_se_anula_no_mesmo_dia';

  IF NOT v_84 OR
     (SELECT count(*) FROM supabase_migrations.schema_migrations
       WHERE version IN ('20261184000000', '20261185000000'))
       <> (1 + v_85::integer) THEN
    RAISE EXCEPTION 'ROLLBACK_PIX_RECUSADO: ledger 84/85 ausente ou divergente';
  END IF;

  IF to_regprocedure('public.iniciar_venda_presencial_pix(jsonb,uuid,uuid,text,text,numeric,text)') IS NULL
     OR to_regprocedure('public.venda_do_balcao_paga_e_entregue()') IS NULL
     OR to_regprocedure('public.venda_do_balcao_guarda_o_status()') IS NULL
     OR (to_regprocedure('public.anular_venda_presencial(uuid,text)') IS NOT NULL) IS DISTINCT FROM v_85
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'public.marketplace_orders'::regclass
            AND tgname = 'tr_venda_do_balcao_paga_e_entregue'
            AND tgfoid = to_regprocedure('public.venda_do_balcao_paga_e_entregue()')
            AND tgenabled = 'O' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'public.marketplace_orders'::regclass
            AND tgname = 'tr_venda_do_balcao_guarda_o_status'
            AND tgfoid = to_regprocedure('public.venda_do_balcao_guarda_o_status()')
            AND tgenabled = 'O' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ROLLBACK_PIX_RECUSADO: objetos 84/85 divergentes do ledger';
  END IF;

  -- A 84 pode ter aberto PIX ainda aguardando; derrubar o gatilho deixaria
  -- a confirmação futura sem entrega automática. Toda venda nessa forma
  -- bloqueia o rollback, inclusive paga, expirada ou cancelada.
  IF EXISTS (SELECT 1 FROM public.marketplace_orders
       WHERE canal = 'presencial' AND payment_method = 'online' AND metodo_online = 'pix')
     OR EXISTS (SELECT 1 FROM public.marketplace_order_history
       WHERE notes LIKE 'Venda no balcão — aguardando o PIX%'
          OR notes LIKE 'Venda no balcão — PIX confirmado%')
     OR EXISTS (SELECT 1 FROM public.marketplace_order_history
       WHERE notes LIKE 'Venda do balcão anulada:%')
     OR EXISTS (SELECT 1 FROM public.marketplace_order_payment_history
       WHERE acao = 'desfeito' AND payment_status_antes = 'recebido_na_entrega'
         AND payment_status_depois = 'estornado') THEN
    RAISE EXCEPTION 'ROLLBACK_PIX_RECUSADO: 84/85 já usadas em pedidos ou pagamentos';
  END IF;
END
$rollback$;

DROP FUNCTION IF EXISTS public.anular_venda_presencial(uuid, text);
DROP TRIGGER tr_venda_do_balcao_guarda_o_status ON public.marketplace_orders;
DROP FUNCTION public.venda_do_balcao_guarda_o_status();
DROP TRIGGER tr_venda_do_balcao_paga_e_entregue ON public.marketplace_orders;
DROP FUNCTION public.venda_do_balcao_paga_e_entregue();
DROP FUNCTION public.iniciar_venda_presencial_pix(jsonb, uuid, uuid, text, text, numeric, text);

DELETE FROM supabase_migrations.schema_migrations
 WHERE (version = '20261184000000' AND name = 'o_pix_do_balcao_abre_na_hora')
    OR (version = '20261185000000' AND name = 'a_venda_do_balcao_se_anula_no_mesmo_dia');
