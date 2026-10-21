import type { Order } from "@/types";

/**
 * Quando o botão "Reenviar comprovante" do detalhe do pedido pode aparecer.
 *
 * O botão chama a edge `send-order-confirmation`, que exige sessão do dono
 * ou de admin atual. O miolo `enviarComprovantePedido` também verifica o
 * pagamento: online diferente de `pago` é recusado ANTES de reservar o
 * ÚNICO e-mail do pedido (`reivindicar_email_de_confirmacao`). A mesma
 * reserva é usada pelos avisos de pagamento confirmado e atrasado.
 * A tela só oferece o botão quando o comprovante faz sentido:
 *
 *  - `pago` (online com o dinheiro confirmado): o e-mail é o comprovante de
 *    verdade — o botão aparece.
 *  - `null` ou `recebido_na_entrega` com forma que NÃO é `online` (pagar na
 *    entrega ou na retirada): comprovante comum, sem cobrança online — aparece.
 *  - qualquer outro caso (aguardando, recusado, expirado, estornado, pago depois
 *    de expirar; `online` sem status; forma de entrega com status de cobrança
 *    online): não aparece. No online, o backend também protege a reserva.
 *
 * Conservador de propósito: na dúvida o botão some. Esta função só decide
 * a TELA; a autorização e a proteção da reserva continuam no backend.
 */
export function podeReenviarComprovante(
  pedido: Pick<Order, "paymentMethod" | "paymentStatus">,
): boolean {
  const pagamento = pedido.paymentStatus ?? null;
  if (pagamento === "pago") return true;
  if (pagamento === null || pagamento === "recebido_na_entrega") {
    return pedido.paymentMethod !== "online";
  }
  return false;
}
