-- Backfill dos pedidos abandonados (CHECKOUT-010 #109). SEM BEGIN/COMMIT.
--
-- Cancela os pedidos abandonados que nunca tiveram pagamento e devolve o
-- estoque que eles seguravam. Medido em 06/08/2026: 13 pedidos, 33 unidades.
--
-- CORTE ABSOLUTO, nao `now() - interval '30 dias'`: com corte relativo, o
-- conjunto muda conforme a hora do apply. A Isadora Bernardes (created_at
-- 2026-07-08T02:30Z, que o painel mostra como 07/07 23:30 no fuso de Brasilia
-- — a unica cliente de verdade entre os pendentes) entraria num corte relativo
-- as 23:30 de 06/08/2026. Data fixa faz este arquivo valer igual em qualquer
-- hora e em qualquer replay.
--
-- O corte deixa 17,1 h de folga do ultimo pedido incluido e 2,5 h da Isadora.
--
-- NAO toca os pendentes de 08/07 e 30/07: ficam para revisao manual.
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
          AND created_at < timestamptz '2026-07-08 00:00:00+00'
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

    -- EXCEPTION, nao NOTICE: o notice do pg nao chega ao terminal (o
    -- db-apply.cjs nao registra listener), entao um desvio comitaria calado.
    -- Aqui, qualquer numero fora do medido derruba a transacao inteira.
    IF v_pedidos <> 13 OR v_unidades <> 33 THEN
        RAISE EXCEPTION
          'Backfill abortado: esperava 13 pedidos e 33 unidades, veio % e %.',
          v_pedidos, v_unidades;
    END IF;

    RAISE NOTICE 'Backfill: % pedidos cancelados, % unidades devolvidas',
                 v_pedidos, v_unidades;
END;
$backfill$;
