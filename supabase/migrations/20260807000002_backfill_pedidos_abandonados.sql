-- Backfill dos pedidos abandonados (CHECKOUT-010 #109). SEM BEGIN/COMMIT.
--
-- Cancela os pedidos pendentes com 30+ dias que nunca tiveram pagamento e
-- devolve o estoque que eles seguravam. Medido em 06/08/2026: 13 pedidos,
-- 33 unidades — contra um catalogo vivo de 28 unidades.
--
-- NAO toca os pendentes com menos de 30 dias: ficam para revisao manual.
-- NAO estorna dinheiro: nenhum desses pedidos foi pago.

DO $backfill$
DECLARE
    v_pedido    RECORD;
    v_unidades  integer := 0;
    v_pedidos   integer := 0;
BEGIN
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE status = 'pending'
          AND payment_status IS NULL
          AND created_at < now() - interval '30 days'
        FOR UPDATE
    LOOP
        v_unidades := v_unidades + public.devolver_estoque(v_pedido.id);

        UPDATE public.marketplace_orders
           SET payment_status = 'expirado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = v_pedido.id;

        v_pedidos := v_pedidos + 1;
    END LOOP;

    RAISE NOTICE 'Backfill: % pedidos cancelados, % unidades devolvidas',
                 v_pedidos, v_unidades;
END;
$backfill$;
