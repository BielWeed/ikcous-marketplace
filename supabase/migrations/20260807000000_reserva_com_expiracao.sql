-- Fase 1 da cobranca no site (CHECKOUT-010 #109 / CHECKOUT-040 #110).
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

-- 1. Colunas de pagamento -----------------------------------------------
-- payment_status fica NULL nas 64 linhas existentes de proposito: as funcoes
-- abaixo so agem sobre 'aguardando', entao historico nao e varrido por engano.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS payment_status     text,
  ADD COLUMN IF NOT EXISTS expires_at         timestamptz,
  ADD COLUMN IF NOT EXISTS gateway_payment_id text;

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_payment_status_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_payment_status_check
  CHECK (payment_status IS NULL OR payment_status IN (
    'aguardando', 'pago', 'recusado', 'expirado', 'estornado', 'pago_apos_expirar'
  ));

-- Indice para a varredura nao fazer seq scan a cada 5 minutos.
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_expiracao
  ON public.marketplace_orders (expires_at)
  WHERE payment_status = 'aguardando';

-- gateway_payment_id e unico: e o que torna o webhook idempotente na Fase 3.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_orders_gateway_payment_id
  ON public.marketplace_orders (gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

-- 2. Devolver estoque ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver$
DECLARE
    v_item     RECORD;
    v_unidades integer := 0;
BEGIN
    FOR v_item IN
        SELECT product_id, variant_id, quantity
        FROM public.marketplace_order_items
        WHERE order_id = p_order_id
    LOOP
        -- IF/ELSE, nao dois IF: a v23 debita XOR (variante OU produto, nunca os
        -- dois), e o front manda product_id preenchido junto com variant_id. Com
        -- dois IF, todo pedido de variante que expirasse creditaria o produto pai
        -- tambem, inflando o catalogo para sempre. Mesma forma do restore que ja
        -- existe em update_order_status_atomic.
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
               SET stock_increment = stock_increment + v_item.quantity
             WHERE id = v_item.variant_id;
        ELSE
            UPDATE public.produtos
               SET estoque = estoque + v_item.quantity
             WHERE id = v_item.product_id;
        END IF;

        v_unidades := v_unidades + v_item.quantity;
    END LOOP;

    RETURN v_unidades;
END;
$devolver$;

REVOKE ALL ON FUNCTION public.devolver_estoque(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.devolver_estoque(uuid) IS
  'Nao e idempotente: duas chamadas para o mesmo pedido creditam estoque duas '
  'vezes. O chamador e responsavel por garantir chamada unica (ex.: transicao '
  'de payment_status que so ocorre uma vez).';

-- 3. Varredura de expiracao ---------------------------------------------
CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $expirar$
DECLARE
    v_pedido   RECORD;
    v_expirados integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED: se o webhook da Fase 3 estiver confirmando este
    -- mesmo pedido agora, ele detem a trava e a varredura pula em vez de
    -- disputar. Quem chegou primeiro ganha; nao ha sobrescrita.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE payment_status = 'aguardando'
          AND expires_at IS NOT NULL
          AND expires_at < now()
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_estoque(v_pedido.id);

        UPDATE public.marketplace_orders
           SET payment_status = 'expirado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = v_pedido.id;

        v_expirados := v_expirados + 1;
    END LOOP;

    RETURN v_expirados;
END;
$expirar$;

REVOKE ALL ON FUNCTION public.expirar_pedidos_vencidos() FROM PUBLIC, anon, authenticated;
