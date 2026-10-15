import type { Order } from "@/types";

/**
 * Quando o botão "Reenviar comprovante" do detalhe do pedido pode aparecer.
 *
 * O botão chama a edge `send-order-confirmation`, que NÃO olha o status do
 * pedido e reserva o ÚNICO e-mail de confirmação dele
 * (`reivindicar_email_de_confirmacao`, vale só na 1ª vez — o mesmo e-mail que
 * o aviso de "pagamento depois do cancelamento" e o de "pagamento confirmado"
 * precisam). O texto que a edge monta depende só de `payment_method` e
 * `payment_status` (`enviarComprovantePedido`, `_shared/comprovante.ts`):
 * forma `online` com pagamento diferente de `pago` sai como "aguardando a
 * confirmação do pagamento". Por isso:
 *
 *  - `pago` (online com o dinheiro confirmado): o e-mail é o comprovante de
 *    verdade — o botão aparece.
 *  - `null` ou `recebido_na_entrega` com forma que NÃO é `online` (pagar na
 *    entrega ou na retirada): comprovante comum, sem cobrança online — aparece.
 *  - qualquer outro caso (aguardando, recusado, expirado, estornado, pago depois
 *    de expirar; `online` sem status; forma de entrega com status de cobrança
 *    online): o toque gastaria a vaga com o e-mail errado, e o de "pago" nunca
 *    mais sairia — não aparece.
 *
 * Conservador de propósito: na dúvida o botão some, porque a vaga do e-mail
 * não tem volta. Só decide a TELA; a edge não muda.
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
