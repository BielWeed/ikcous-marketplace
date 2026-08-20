-- status do pedido nunca fica NULO (achado de 20/08/2026).
--
-- O DEFEITO, EM UMA FRASE
--   `marketplace_orders.status` aceita NULL e nao tem DEFAULT. Em SQL,
--   `NULL = ANY(ARRAY[...])` avalia para NULL, e uma CHECK passa quando o
--   resultado e NULL (nao so quando e TRUE) — entao `marketplace_orders_status_check`
--   nunca impediu um INSERT que omitisse `status`. Foi assim que uma linha com
--   status NULO entrou no banco em 20/08/2026 (pedido de R$ 105,00, ja
--   removido). O painel filtra por `status` em quase toda conta (Receita
--   Hoje, Acoes Pendentes, Ticket Medio, Total Concluido, o cracha da
--   navegacao, o proprio filtro "Novo Pedido"), e comparacao com NULL nunca e
--   verdadeira — entao o pedido ficava visivel so na lista "Todos Ativos"
--   (unica consulta sem filtro de status) e invisivel em todo o resto,
--   inclusive fora do alcance da `expirar_pedidos_vencidos` (que exige
--   `status = 'pending'`).
--
-- POR QUE 'pending'
--   E o valor que o proprio checkout ja grava fixo na criacao do pedido
--   (create_marketplace_order_v23/v24, INSERT do pedido:
--   supabase/migrations/20260807000000_reserva_com_expiracao.sql) e o que a
--   tela ja assumia no fallback `statusConfig[status || "pending"]`. Nao
--   inventa um estado novo: só torna explicito o que já era o comportamento
--   esperado.
--
-- O QUE NAO MUDA
--   A CHECK `marketplace_orders_status_check` continua igual — ela ja diz o
--   conjunto de valores validos, o buraco era so o NULL escapando dela.
--   `payment_status` NAO e tocado: NULL ali e estado legitimo ("sem cobranca
--   online"), guarda de proposito.
--
-- O BACKFILL
--   Hoje sao 0 linhas com status NULO neste banco (a linha de teste foi
--   apagada). O UPDATE abaixo existe para a migration ser correta em
--   QUALQUER banco clonado deste molde, nao para este banco especifico —
--   sem ele, um banco com uma linha NULA pre-existente falharia no
--   `SET NOT NULL` seguinte.
--
-- Sem BEGIN/COMMIT, de proposito: com eles o ROLLBACK do script de prova
-- vira no-op e a mudanca fica gravada mesmo assim.
-- Prova: node scripts/db-prove-status-nao-nulo.cjs

UPDATE public.marketplace_orders
   SET status = 'pending'
 WHERE status IS NULL;

ALTER TABLE public.marketplace_orders
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.marketplace_orders
  ALTER COLUMN status SET NOT NULL;
