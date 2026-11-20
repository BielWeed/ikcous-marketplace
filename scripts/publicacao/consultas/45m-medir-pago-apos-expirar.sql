-- 45m — MEDICAO, so leitura: pedidos atualmente marcados como pagos apos expirar.
-- Molde da 44m: UM SELECT de ROL ABERTO (tipo | objeto | detalhe), sem coluna ok.
-- Rodar em ikcous-publicada e savy, uma loja por run. O resultado nao e prova do portao.
-- Historico por mes de CRIACAO em Sao Paulo (nao o mes em que o pagamento entrou).
-- O contexto conta pedidos pagos pelo app (payment_method = 'online'), incluindo os
-- pagos apos expirar, no mesmo mes. Nao representa pagamentos ja mudados para estornado.
-- So contagens e datas sem horario, por metodos de lista fechada. Sem dados pessoais.
-- Nenhum valor em reais sai no log publico; confira valores em consulta privada.
WITH base AS (
  SELECT (o.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
         CASE WHEN o.payment_method IN ('online', 'pix', 'card', 'cash') THEN o.payment_method
              WHEN o.payment_method IS NULL THEN 'nulo'
              ELSE 'outro' END AS metodo,
         o.payment_status AS pagto
    FROM public.marketplace_orders o
   WHERE o.payment_status = 'pago_apos_expirar'
      OR (o.payment_method = 'online' AND o.payment_status = 'pago')
), mensal AS (
  SELECT date_trunc('month', dia::timestamp)::date AS mes, dia, metodo, pagto
    FROM base
), r AS (
  SELECT 0 AS ordem, 'controle' AS tipo, 'visibilidade' AS objeto,
         'rls_vale_em_marketplace_orders='
         || row_security_active('public.marketplace_orders'::regclass)::text AS detalhe
  UNION ALL
  SELECT 1, 'pago_apos_expirar', to_char(mes, 'YYYY-MM') || ' | ' || metodo,
         'pedidos=' || count(*)::text
         || '|primeira_data=' || to_char(min(dia), 'YYYY-MM-DD')
         || '|ultima_data=' || to_char(max(dia), 'YYYY-MM-DD')
    FROM mensal
   WHERE pagto = 'pago_apos_expirar'
   GROUP BY mes, metodo
  UNION ALL
  SELECT 2, 'pagos_online', to_char(mes, 'YYYY-MM'),
         'pedidos=' || count(*) FILTER (WHERE metodo = 'online')::text
    FROM mensal
   GROUP BY mes
)
SELECT tipo, objeto, detalhe
  FROM r
 ORDER BY ordem, objeto, detalhe;
