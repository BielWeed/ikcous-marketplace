-- Issue #180: a fila de reconciliacao nunca alcanca o pedido cancelado pelo
-- app cujo PIX foi pago mesmo assim. NAO e' regressao: o buraco ja existia
-- antes da Fase 3.
-- SEM BEGIN/COMMIT: quem abre a transacao e' quem aplica.

-- O buraco: o cliente cancela pelo app com o QR do PIX na mao.
-- update_order_status_atomic devolve o estoque e grava status='cancelled',
-- mas NAO escreve payment_status (20260806000000_baseline_do_schema_vivo.sql)
-- — o pedido fica 'aguardando' + 'cancelled'. Se o cliente paga o PIX assim
-- mesmo e o webhook se perde (MP falha em entregar, funcao fora do ar, deploy
-- no meio), ninguem jamais pergunta ao MP por aquela cobranca:
--   - pagamentos_a_reconciliar exigia payment_status='expirado' — o pedido
--     esta 'aguardando', nunca vira candidato.
--   - expirar_pedidos_vencidos (20260807000000_reserva_com_expiracao.sql)
--     exige status='pending' — o pedido esta 'cancelled', nunca a alcanca.
-- Dinheiro parado no MP, app mostrando "Aguardando pagamento", zero sinal de
-- atencao no admin, e nenhuma varredura que corrija com o tempo.
--
-- O ramo novo devolve ESTE candidato para a fila, sem afrouxar as guardas que
-- ja protegiam o candidato 'expirado':
--   - `paid_at IS NULL` continua valendo para ele pela MESMA razao que ja
--     vale para o 'expirado': se ja tem paid_at, confirmar_pagamento ja
--     decidiu ('ja_pago') e reconsultar o MP e' trabalho a toa.
--   - a janela de 24h continua valendo pela MESMA razao: passado esse prazo
--     o PIX ja nao e' pagavel no MP, e manter o candidato na fila so faria a
--     reconciliacao perguntar por uma cobranca morta a cada 10 minutos.
-- A decisao do que fazer com o candidato continua INTEIRA na
-- confirmar_pagamento (20260810000000_confirmar_pagamento_guarda_status.sql)
-- — esta funcao so seleciona, nao decide (mesmo motivo do comentario em
-- 20260808000100_reconciliacao.sql:4-8: dois lugares decidindo a partir de
-- status de pagamento divergem em tres meses, como a regra de frete gratis do
-- #53). Para o candidato novo, confirmar_pagamento ja sabe tratar
-- 'aguardando' + status='cancelled' no ramo 'pago': vira 'pago_apos_expirar'
-- (mesmo balde de atencao do 'expirado', 20260810000000:173-180) e o estoque
-- NAO e mexido de novo, porque update_order_status_atomic ja devolveu no
-- cancelamento.
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
       -- do historico inteiro a cada 10 minutos. Vale para os dois ramos do
       -- OR abaixo, pelo mesmo motivo.
       AND expires_at > now() - interval '24 hours'
       AND (
             payment_status = 'expirado'
          OR (payment_status = 'aguardando' AND status = 'cancelled')
       )
     -- DESC + LIMIT 100 preservados sem mudanca: o raciocinio completo (por
     -- que DESC serve primeiro quem tem mais chance de ter pago, e por que a
     -- starvation do candidato velho e' aceita de proposito) esta em
     -- 20260808000100_reconciliacao.sql:23-35 e vale igual para o ramo novo.
     ORDER BY expires_at DESC
     LIMIT 100;
$candidatos$;

REVOKE ALL ON FUNCTION public.pagamentos_a_reconciliar()
  FROM PUBLIC, anon, authenticated;
