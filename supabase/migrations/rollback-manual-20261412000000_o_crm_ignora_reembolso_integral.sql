-- Restaura exatamente public.crm__vendas da 20261399990000. Não toca dados nem grants.

CREATE OR REPLACE FUNCTION public.crm__vendas(p_ate timestamptz)
RETURNS TABLE (
  order_id uuid, total numeric, canal text, forma text, pago_em timestamptz, dia date,
  chave text, user_id uuid, nome text, whatsapp text, email text
)
LANGUAGE sql STABLE SET search_path = public
AS $$
  WITH base AS (
    SELECT o.id, o.total::numeric AS total, o.canal, o.user_id, o.customer_name,
           public.fin__forma_do_pedido(o.payment_method, o.metodo_online) AS forma,
           COALESCE(o.pagamento_recebido_em, o.paid_at) AS pago_em,
           NULLIF(regexp_replace(COALESCE(o.customer_data ->> 'whatsapp', ''), '\D', '', 'g'), '') AS wa,
           NULLIF(btrim(COALESCE(o.customer_data ->> 'email', '')), '') AS email
      FROM public.marketplace_orders o
     WHERE o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
       AND o.status NOT IN ('cancelled', 'returned')
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL
       AND COALESCE(o.pagamento_recebido_em, o.paid_at) <= p_ate
  ), base_chave AS (
    -- O MESMO WhatsApp gravado uma vez com o 55 (balcao, "+55...") e outra sem (conta, "(34)...") e UM comprador: a chave e a fusao comparam o
    -- numero SEM o 55 quando ele tem DDI (12 ou 13 digitos comecando por 55), a mesma expressao de crm__pedidos_nao_pagos e crm__nunca_comprou
    -- (20261183000000, N4). O DDD 55 com 11 digitos nao perde o 55. `wa` (o que se exibe) continua o numero original do pedido.
    SELECT b.*,
           CASE WHEN length(b.wa) IN (12, 13) AND left(b.wa, 2) = '55'
                THEN substring(b.wa FROM 3) ELSE b.wa END AS wa_chave
      FROM base b
  ), wa_da_conta AS (
    SELECT DISTINCT ON (b.wa_chave) b.wa_chave, b.user_id
      FROM base_chave b
     WHERE b.wa_chave IS NOT NULL AND b.user_id IS NOT NULL
     ORDER BY b.wa_chave, b.pago_em DESC
  )
  SELECT b.id, b.total, b.canal, b.forma, b.pago_em, public.fin__dia(b.pago_em),
         COALESCE(b.user_id::text, w.user_id::text, CASE WHEN b.wa_chave IS NOT NULL THEN 'wa:' || b.wa_chave END),
         COALESCE(b.user_id, w.user_id),
         NULLIF(btrim(b.customer_name), ''), b.wa, b.email
    FROM base_chave b
    LEFT JOIN wa_da_conta w ON w.wa_chave = b.wa_chave AND b.user_id IS NULL
$$;
