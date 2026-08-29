-- ROLLBACK MANUAL de 20261010000000_reconciliacao_alcanca_o_pedido_vivo.sql
-- SEM BEGIN/COMMIT: quem abre a transacao e' quem aplica.
--
-- ALCANCE DECLARADO, para a prova de rollback saber o que conferir:
--   Objeto tocado: UM — a funcao public.pagamentos_a_reconciliar().
--   Nao cria, nao apaga e nao altera tabela, coluna, indice, policy nem
--   qualquer outra funcao. Nao move dado: a funcao e' `LANGUAGE sql` e so'
--   le. Aplicar ou reverter esta migration nao muda uma linha de
--   marketplace_orders.
--   Efeito observavel unico: quais pedidos a varredura de reconciliacao
--   enxerga como candidatos.
--
-- ESTE ARQUIVO DEVOLVE o corpo exato de 20260812000000_reconciliar_pedido_
-- cancelado.sql, que era o estado imediatamente anterior — dois ramos no OR,
-- sem o ramo do pedido vivo.
--
-- `CREATE OR REPLACE` e nao `DROP` + `CREATE`: dropar a funcao apagaria os
-- grants junto, e o REVOKE abaixo repoe a intencao mas nao repoe o que outro
-- objeto tivesse concedido. Substituir preserva dono e permissoes.
--
-- ⚠️ O QUE VOLTA A ACONTECER se este rollback for aplicado: o PIX pago cujo
-- aviso do Mercado Pago nao chega volta a virar pedido CANCELADO aos 30
-- minutos, com o estoque devolvido a' vitrine e sem comprovante ao cliente.
-- A varredura volta a so' enxergar pedido ja morto. Reverter aqui e' escolher
-- de novo o defeito PEDIDO-01 — so' faca isso se a migration tiver causado
-- algo pior.
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
