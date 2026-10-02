-- Diagnóstico temporário de retorno ao projeto original.
-- Exibe somente booleanos; nenhum pedido, cliente, identificador ou valor vai ao log público.
-- Referência medida por leitura no projeto original após a restauração em 01/10/2026.
WITH retrato AS (
  SELECT
    md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) AS ids_digest,
    md5(coalesce(string_agg(
      jsonb_build_array(
        id, status, payment_status, total_amount, gateway_payment_id,
        (extract(epoch FROM updated_at) * 1000000)::bigint
      )::text,
      E'\n' ORDER BY id
    ), '')) AS state_digest,
    max(created_at) AS ultimo_pedido
  FROM public.marketplace_orders
)
SELECT
  ids_digest = 'e4e2d023c861245287e7b8caf52f4efa' AS mesmos_pedidos,
  state_digest = 'f70ee9b9fd1cbb2a5d224ebc9dd622cd' AS mesmos_estados_de_pagamento,
  coalesce(ultimo_pedido > timestamptz '2026-09-25 18:38:46.560737+00', false) AS pedido_mais_recente_no_banco_novo
FROM retrato;
