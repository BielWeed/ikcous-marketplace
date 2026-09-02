-- ============================================================================
-- Migration 20261073000000 — o selo "Compra Verificada" não conta pedido morto
-- (laudo varredura profunda #2, achado L-10, 01/09/2026)
-- ============================================================================
--
-- O PROBLEMA: as duas triggers do selo (20261030) filtravam só o DINHEIRO
-- (`payment_status IN ('pago','pago_apos_expirar','recebido_na_entrega')`) sem
-- olhar o DESTINO do pedido — um pedido pago e depois cancelado/reembolsado
-- continuava conferindo selo "Compra Verificada" na avaliação.
--
-- A CURA: as mesmas funções com o portão de status a mais (`status NOT IN
-- ('cancelled','returned')`). Atributos repetidos por extenso (SECURITY
-- DEFINER, search_path) — regra do CREATE OR REPLACE da casa.
--
-- DELIBERADO FORA: retroativo RETIRANDO selo já conferido por pedido morto —
-- mexer em avaliação já publicada é decisão de produto (o rótulo é derivado,
-- mas retirada retroativa afeta avaliações no ar sem o dono ver). Fica
-- registrado no recado da onda para o Gabriel decidir.
--
-- COMO PROVAR (ficha db-prove, medição em conexão nova):
--   node scripts/db-prove-onda-d-painel.cjs
-- VERIFICACOES: entrada em scripts/db-apply.cjs (redefine função).
-- Rollback: rollback-manual-20261073000000_*.sql (recria os corpos da 20261030).
-- SEM BEGIN/COMMIT.
-- ============================================================================

-- 1. Trigger de review nova (quem já comprou E o pedido está vivo) -----------
CREATE OR REPLACE FUNCTION public.marca_avaliacao_nasce_verificada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.marketplace_orders o
        JOIN public.marketplace_order_items oi ON oi.order_id = o.id
        WHERE o.user_id = NEW.user_id
          AND oi.product_id = NEW.product_id
          AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
          AND o.status NOT IN ('cancelled', 'returned')
    ) THEN
        UPDATE public.reviews SET verified = true WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

-- 2. Trigger de pedido pago (confere as avaliações do comprador) --------------
CREATE OR REPLACE FUNCTION public.marca_avaliacoes_do_pedido_verificadas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.user_id IS NOT NULL
       AND NEW.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
       AND NEW.status NOT IN ('cancelled', 'returned') THEN
        UPDATE public.reviews r
           SET verified = true
         WHERE r.user_id = NEW.user_id
           AND r.verified = false
           AND EXISTS (
               SELECT 1 FROM public.marketplace_order_items oi
               WHERE oi.order_id = NEW.id
                 AND oi.product_id = r.product_id
           );
    END IF;
    RETURN NEW;
END;
$$;
