-- Auditoria geral de 26/08/2026, achado PEDIDO-01: o cliente paga o PIX, o
-- aviso do Mercado Pago nao chega, e aos 30 minutos o pedido e' CANCELADO com
-- o estoque devolvido para a vitrine. Dinheiro parado no MP, produto revendido
-- para outra pessoa, nenhum comprovante ao cliente.
-- SEM BEGIN/COMMIT: quem abre a transacao e' quem aplica.
--
-- O BURACO. `pagamentos_a_reconciliar()` (20260812000000) so' devolve dois
-- tipos de candidato:
--     payment_status = 'expirado'
--  OR (payment_status = 'aguardando' AND status = 'cancelled')
-- Os dois descrevem pedido que JA MORREU. O pedido VIVO — 'aguardando' +
-- 'pending', com o PIX pago e o webhook perdido — nao satisfaz nenhum dos
-- ramos. A varredura roda a cada 10 minutos e passa reto por ele ate a
-- expirar_pedidos_vencidos (20260807000000) matar o pedido aos 30 min. So'
-- ENTAO ele vira candidato, e ja e' tarde: confirmar_pagamento devolve
-- 'pago_apos_expirar' — nao repoe status, nao retira o estoque que voltou, e
-- o comprovante ao cliente nunca sai, porque o disparo em
-- webhook-mercadopago/index.ts:746 exige resultado === 'pago'.
--
-- Ou seja: a unica rede de seguranca que existe hoje so' e' acionada DEPOIS
-- que o dano ja aconteceu. Ela registra a perda; nao a evita.
--
-- POR QUE ISSO NAO E' O CASO RARO. `montarCorpoPixOrders`
-- (_shared/mercadopago.ts:338-360) nao envia `notification_url` — o proprio
-- comentario em webhook-mercadopago/index.ts:434-437 registra que o campo nao
-- e' aceito no corpo da Orders API, que a entrega depende do cadastro no
-- painel do MP, e que NINGUEM neste projeto jamais observou uma notificacao
-- real da Orders API chegar. Se o painel nao estiver inscrito, o caminho
-- acima nao e' excecao: e' o destino de TODO PIX pago.
--
-- O QUE ESTA MIGRATION FAZ. Acrescenta UM ramo ao WHERE: o pedido vivo com
-- cobranca no gateway e sem pagamento registrado tambem e' candidato. Nada
-- mais muda.
--
-- POR QUE E' SEGURO — a decisao continua inteira em confirmar_pagamento.
-- Esta funcao SELECIONA, nunca decide (mesmo motivo escrito em
-- 20260808000100_reconciliacao.sql:4-8: dois lugares decidindo a partir de
-- status de pagamento divergem em tres meses). Para o candidato novo,
-- confirmar_pagamento (20260901000000:496+) ja sabe exatamente o que fazer:
-- com payment_status='aguardando', a guarda `= 'cancelled'` NAO casa, entao
-- ele cai no ramo 'pago' normal — grava payment_status='pago' e paid_at, e
-- NAO mexe em estoque (nao precisa: a reserva nunca foi devolvida, o pedido
-- esta vivo). E' o desfecho correto, e e' o mesmo que o webhook produziria se
-- tivesse chegado. Nenhuma linha de confirmar_pagamento muda aqui.
--
-- AS TRES GUARDAS DE CIMA CONTINUAM VALENDO, e pelo MESMO motivo de antes:
--   - `gateway_payment_id IS NOT NULL`: sem cobranca no MP nao ha o que
--     perguntar.
--   - `paid_at IS NULL`: se ja tem, confirmar_pagamento ja decidiu ('ja_pago')
--     e reconsultar o MP e' trabalho a toa.
--   - janela de 24 h: passado o prazo o PIX nao e' mais pagavel, e manter o
--     candidato so' faria a varredura perguntar por cobranca morta de 10 em
--     10 minutos.
--
-- SOBRE A ORDEM E O TETO, que nao mudam. `ORDER BY expires_at DESC LIMIT 100`
-- foi escolhido em 20260808000100:23-35 para servir primeiro quem tem mais
-- chance de ter pago. O pedido vivo tem o `expires_at` mais distante, entao
-- passa a ser servido PRIMEIRO — e isso e' desejavel, nao um efeito colateral:
-- ele e' o unico que ainda da' para salvar, enquanto o 'expirado' ja e' perda
-- consumada. O teto de 100 a cada 10 minutos continua segurando o custo e o
-- limite de chamadas ao MP (<= 10 por minuto no pior caso).
-- A starvation do candidato velho, aceita de proposito la', continua aceita
-- aqui pelo mesmo motivo — e agora com uma razao a mais.
--
-- CUSTO NOVO, dito por inteiro: a varredura passa a perguntar ao MP tambem
-- por pedidos que ainda nem foram pagos, e a maioria vai voltar "pendente" e
-- ser ignorada. Um PIX vive 30 minutos, entao cada pedido e' consultado ~3
-- vezes antes de expirar. E' esse o preco de deixar de perder venda paga.
CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT id, gateway_payment_id
      FROM public.marketplace_orders
     WHERE gateway_payment_id IS NOT NULL
       AND paid_at IS NULL
       -- 24 h: depois disso o PIX ja nao e' pagavel e a janela vira varredura
       -- do historico inteiro a cada 10 minutos. Vale para os TRES ramos do
       -- OR abaixo, pelo mesmo motivo.
       AND expires_at > now() - interval '24 hours'
       AND (
             -- morto por expiracao (20260808000100)
             payment_status = 'expirado'
             -- morto por cancelamento do cliente com o QR na mao (20260812000000)
          OR (payment_status = 'aguardando' AND status = 'cancelled')
             -- VIVO, e ainda da' para salvar (26/08/2026, achado PEDIDO-01).
             -- Este e' o unico ramo que PREVINE a perda em vez de registra-la.
          OR (payment_status = 'aguardando' AND status = 'pending')
       )
     ORDER BY expires_at DESC
     LIMIT 100;
$candidatos$;

REVOKE ALL ON FUNCTION public.pagamentos_a_reconciliar()
  FROM PUBLIC, anon, authenticated;
