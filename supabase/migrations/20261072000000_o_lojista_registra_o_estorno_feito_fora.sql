-- ============================================================================
-- Migration 20261072000000 — o lojista registra o estorno que fez fora do app
-- (laudo varredura profunda #2, achado L-2, 01/09/2026)
-- ============================================================================
--
-- O PROBLEMA: o balde "Devolver agora" do painel só sai quando
-- `payment_status` vira 'estornado' — e o único escritor desse valor é o
-- webhook do Mercado Pago, que o PRÓPRIO CÓDIGO admite nunca ter sido
-- observado chegar (webhook-mercadopago/index.ts:434-438, issue #212 — a
-- entrega depende de cadastro manual no painel do MP). A reconciliação não
-- alcança pedido já pago (`paid_at IS NULL`, 20261010:78). Resultado: sem a
-- notificação, o card fica na tela para sempre — e o lojista para de confiar
-- na lista no dia em que ela importa.
--
-- A CURA: porta MANUAL e guarda — o lojista confirma no app que JÁ estornou
-- no Mercado Pago, e o pedido sai do balde. Idempotente: se já estiver
-- 'estornado', não mexe e devolve ok.
--
-- POR QUE NÃO AVISA O CLIENTE: 'estornado' está no silêncio do sino POR
-- DESENHO (20261027) — quem chega aqui já devolveu o dinheiro por fora
-- (PIX/cartão estornado no próprio MP); o app não tem o que anunciar.
--
-- SEGURANÇA: SECURITY DEFINER com guarda `is_admin()` no corpo (padrão das
-- RPCs de admin da casa) + EXECUTE só para authenticated.
--
-- COMO PROVAR (ficha db-prove, medição em conexão nova):
--   node scripts/db-prove-onda-d-painel.cjs
-- VERIFICACOES: entrada em scripts/db-apply.cjs (redefine função).
-- Rollback: rollback-manual-20261072000000_*.sql versionado junto.
-- SEM BEGIN/COMMIT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.registrar_estorno_manual(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existe boolean;
    v_ja_estornado boolean;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'somente a loja registra o estorno'
            USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.marketplace_orders WHERE id = p_order_id
    ),
    EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE id = p_order_id AND payment_status = 'estornado'
    )
    INTO v_existe, v_ja_estornado;

    IF NOT v_existe THEN
        RAISE EXCEPTION 'pedido nao encontrado' USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_ja_estornado THEN
        UPDATE public.marketplace_orders
           SET payment_status = 'estornado'
         WHERE id = p_order_id;
    END IF;

    RETURN json_build_object('ok'::text, true, 'payment_status'::text, 'estornado');
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_estorno_manual(uuid) FROM public;
REVOKE ALL ON FUNCTION public.registrar_estorno_manual(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_estorno_manual(uuid) TO authenticated;
