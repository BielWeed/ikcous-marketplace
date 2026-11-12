-- 129m-medir-corrida-e-avanco-com-estorno: SO LEITURA, somente oito CONTAGENS.
-- Uma linha, nenhum identificador ou valor individual sai para os logs publicos.
-- Unidade: PEDIDOS distintos, nao eventos; EXISTS nao multiplica pedidos com varios eventos.
-- Historico: marketplace_order_history (baseline 20260806000000); canal presencial = balcao
-- (20261160000000). valor_estornado e o acumulado confirmado (2026110000000).
-- Janela de corrida e apenas INDICIO: avanco anterior estrito, ate 2 min inclusive,
-- atores conhecidos e diferentes; NULL em created_by nao prova dois atores.
-- Cancelados vindos de delivered: ainda cancelados e com essa transicao no historico.
-- Reativados: qualquer reativacao registrada, mesmo se o pedido foi cancelado de novo.
-- Rodar com leitura integral das duas tabelas, sem RLS filtrando; zero sob filtro nao prova ausencia.
SELECT
  count(*) FILTER (WHERE o.status IN ('pending', 'processing', 'shipping')
    AND o.payment_status = 'estornado') AS vivos_com_pagamento_estornado,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM public.marketplace_order_history a
    WHERE a.order_id = o.id AND a.new_status IN ('processing', 'shipping', 'delivered')
      AND a.created_at > o.estorno_manual_registrado_em
  )) AS pedidos_avancados_depois_do_estorno,
  count(*) FILTER (WHERE o.canal IS DISTINCT FROM 'presencial' AND EXISTS (
    SELECT 1 FROM public.marketplace_order_history c
    WHERE c.order_id = o.id AND c.new_status = 'cancelled' AND EXISTS (
      SELECT 1 FROM public.marketplace_order_history a
      WHERE a.order_id = c.order_id AND a.new_status IN ('shipping', 'delivered')
        AND c.created_at > a.created_at
        AND c.created_at <= a.created_at + interval '2 minutes'
        AND c.created_by <> a.created_by
    )
  )) AS cancelados_ate_dois_minutos_apos_avanco_por_outro_ator,
  count(*) FILTER (WHERE o.status = 'cancelled' AND o.canal IS DISTINCT FROM 'presencial' AND EXISTS (
    SELECT 1 FROM public.marketplace_order_history c
    WHERE c.order_id = o.id AND c.old_status = 'delivered' AND c.new_status = 'cancelled'
  )) AS cancelados_vindos_de_entregue_fora_do_balcao,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM public.marketplace_order_history r
    WHERE r.order_id = o.id AND r.old_status = 'cancelled' AND r.new_status <> 'cancelled'
  )) AS pedidos_reativados,
  count(*) FILTER (WHERE o.status IN ('pending', 'processing', 'shipping')
    AND o.stock_returned_at IS NOT NULL) AS vivos_com_estoque_devolvido,
  count(*) FILTER (WHERE o.valor_estornado >= o.total AND o.total > 0
    AND o.payment_status <> 'estornado') AS estorno_integral_sem_selo,
  count(*) AS total_de_pedidos
FROM public.marketplace_orders o;
