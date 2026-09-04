-- ============================================================================
-- ROLLBACK MANUAL — 20261080000000 (a etiqueta do envio nasce da API)
-- ============================================================================
-- Desfaz a 20261080000000 na ordem segura: políticas primeiro, tabela nova
-- depois, colunas do pedido por último.
--
-- ATENÇÃO antes de rodar: apagar as colunas do pedido PERDE o vínculo com
-- etiquetas já compradas no Melhor Envio (o `shipping_label_id` é a chave para
-- reimprimir, cancelar e consultar o rastreio). As etiquetas continuam na
-- conta do ME do lojista — o que se perde aqui é o atalho pelo painel. Só
-- rodar se a Onda 3 for abandonada sem pedidos etiquetados, ou com o dono
-- ciente do deslinque. NUNCA `supabase db push`.
-- SEM BEGIN/COMMIT (regra da casa).
-- ============================================================================

-- 1. Políticas da tabela nova (dropar antes da tabela) ------------------------

DROP POLICY IF EXISTS order_shipping_events_admin_delete_policy
    ON public.order_shipping_events;

DROP POLICY IF EXISTS order_shipping_events_admin_update_policy
    ON public.order_shipping_events;

DROP POLICY IF EXISTS order_shipping_events_admin_insert_policy
    ON public.order_shipping_events;

DROP POLICY IF EXISTS order_shipping_events_select_policy
    ON public.order_shipping_events;

-- 2. O histórico do ciclo de envio ---------------------------------------------

DROP TABLE IF EXISTS public.order_shipping_events;

-- 3. Colunas do pedido -----------------------------------------------------------

ALTER TABLE public.marketplace_orders
    DROP COLUMN IF EXISTS shipping_label_url;

ALTER TABLE public.marketplace_orders
    DROP COLUMN IF EXISTS shipping_label_id;
