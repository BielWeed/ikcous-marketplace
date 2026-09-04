-- ============================================================================
-- Migration 20261080000000 — a etiqueta do envio nasce da API (Onda 3:
-- rastreio automático via Melhor Envio, 03/09/2026)
-- ============================================================================
--
-- O PROBLEMA: até hoje o código de rastreio é digitado À MÃO na ficha do
-- pedido (OrderDetail.tsx, handleSaveTracking) — o lojista compra a etiqueta
-- no site do Melhor Envio, copia o código, cola no painel. Três abas para
-- cada pedido enviado, e o histórico do rastreio não existe em lugar nenhum.
--
-- A CURA (o que o rastreio automático precisa no banco):
--   1. marketplace_orders passa a guardar o resultado da etiqueta gerada pela
--      API: `shipping_label_id` (o id da etiqueta NO Melhor Envio — é com ele
--      que se reimprime, cancela e consulta o rastreio) e `shipping_label_url`
--      (o link de impressão). O `tracking_code` JÁ EXISTIA (baseline) e não
--      nasce de novo.
--   2. Tabela `order_shipping_events`: o histórico do ciclo de envio do
--      pedido (etiqueta gerada, rastreio consultado, erro) — uma linha por
--      evento, com o payload cru para auditoria.
--
-- O QUE NÃO MUDA: nenhuma coluna existente é alterada; nenhuma RPC de pedido
-- é reescrita; a regra de frete (calculate-shipping, contingências) fica
-- intocada. As colunas novas são só para a etiqueta da API.
--
-- RLS: `order_shipping_events` nasce com Row Level Security ATIVADA e
-- políticas explícitas por role, no padrão do baseline:
--   * SELECT: admin (is_admin()) OU dono do pedido (auth.uid() = user_id do
--     pedido — mesma porta do marketplace_orders_select_policy);
--   * INSERT/UPDATE/DELETE: só admin. O app do cliente NUNCA escreve evento —
--     quem escreve é a edge function `melhor-envio-etiqueta` com service role
--     (que não passa por RLS).
--
-- DELIBERADO FORA: notificação automática ao cliente quando o rastreio muda
-- (webhook/polling do Melhor Envio) — o dono aprovou a ONDA 3 (etiqueta +
-- confirmação em 1 clique no painel), não a automação de aviso ao cliente.
--
-- COMO PROVAR (depois de o dono aplicar — NUNCA `supabase db push`):
--   1. \d+ public.order_shipping_events  (RLS enabled, 4 policies)
--   2. SELECT como anon: 0 linhas visíveis em qualquer pedido.
--   3. SELECT como authenticated dono do pedido: vê os eventos DO PRÓPRIO
--      pedido e nenhum de terceiro.
-- Rollback: rollback-manual-20261080000000_*.sql (dropa tabela e colunas).
-- SEM BEGIN/COMMIT (regra da casa — o ROLLBACK do script de prova precisa
-- funcionar).
-- ============================================================================

-- 1. O pedido guarda a etiqueta que a API gerou ------------------------------

ALTER TABLE public.marketplace_orders
    ADD COLUMN IF NOT EXISTS shipping_label_id text;

ALTER TABLE public.marketplace_orders
    ADD COLUMN IF NOT EXISTS shipping_label_url text;

COMMENT ON COLUMN public.marketplace_orders.shipping_label_id IS
    'Id da etiqueta no Melhor Envio (shipment id, UUID). É a chave para reimprimir, cancelar e consultar o rastreio. NULL = etiqueta não gerada pela API.';
COMMENT ON COLUMN public.marketplace_orders.shipping_label_url IS
    'Link de impressão da etiqueta devolvido pelo Melhor Envio (POST /api/v2/me/shipment/print). Link privado: exige login do lojista no Melhor Envio.';

-- 2. O histórico do ciclo de envio -------------------------------------------

CREATE TABLE public.order_shipping_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    provider text DEFAULT 'melhor_envio' NOT NULL,
    event_type text NOT NULL,
    tracking_code text,
    label_url text,
    protocol text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT order_shipping_events_pkey PRIMARY KEY (id),
    CONSTRAINT order_shipping_events_order_id_fkey FOREIGN KEY (order_id)
        REFERENCES public.marketplace_orders (id) ON DELETE CASCADE,
    CONSTRAINT order_shipping_events_event_type_check CHECK (
        event_type = ANY (ARRAY['etiqueta_gerada'::text, 'rastreio_consultado'::text, 'erro'::text])
    )
);

CREATE INDEX IF NOT EXISTS order_shipping_events_order_id_idx
    ON public.order_shipping_events (order_id);

COMMENT ON TABLE public.order_shipping_events IS
    'Histórico do ciclo de envio do pedido (Onda 3): etiqueta gerada pela API do Melhor Envio, consultas de rastreio e erros. Escrita só pela edge function melhor-envio-etiqueta (service role).';

-- 3. RLS — a tabela não existe sem porta --------------------------------------

ALTER TABLE public.order_shipping_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_shipping_events_select_policy
    ON public.order_shipping_events
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1
            FROM public.marketplace_orders o
            WHERE o.id = order_id
              AND o.user_id = (SELECT auth.uid())
        )
    );

CREATE POLICY order_shipping_events_admin_insert_policy
    ON public.order_shipping_events
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY order_shipping_events_admin_update_policy
    ON public.order_shipping_events
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

CREATE POLICY order_shipping_events_admin_delete_policy
    ON public.order_shipping_events
    FOR DELETE
    TO authenticated
    USING ((SELECT public.is_admin()));
