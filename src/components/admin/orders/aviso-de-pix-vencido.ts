import { lerPrazoDoPixEmMs, prazoDoPixPassou } from "@/lib/prazo-do-pix";
import { tipoDeEntregaDoPedido } from "@/lib/tipo-de-entrega-do-pedido";
import type { Order } from "@/types";

function aguardaPixDoApp(order: Order): boolean {
  return (
    tipoDeEntregaDoPedido(order) !== "balcao" &&
    order.paymentStatus === "aguardando" &&
    order.paymentMethod === "online" &&
    order.metodoOnline === "pix"
  );
}

export function aguardaPixOnline(order: Order): boolean {
  // A confirmação de avanço mantém o comportamento anterior para retirada.
  return !order.retiradaNaLoja && aguardaPixDoApp(order);
}

export function avisoDePixVencido(order: Order, agora: number): string | null {
  if (
    (order.status !== "processing" && order.status !== "shipping") ||
    !aguardaPixDoApp(order) ||
    !prazoDoPixPassou(lerPrazoDoPixEmMs(order.expiraEm), agora)
  ) {
    return null;
  }

  const aviso =
    "O Pix deste pedido venceu pelo horário previsto, mas o pagamento ainda não consta.";
  if (order.retiradaNaLoja && !order.cancelledAfterShipping) {
    return `${aviso} Confira com o cliente. Se você não recebeu por fora e a peça continua na loja, use Cancelar pedido para liberar o estoque.`;
  }

  return `${aviso} Se não recebeu por fora, confira com o cliente. Se decidir desistir, use Cancelar pedido.`;
}

export const AVISO_DE_RESERVA_AO_AVANCAR_PIX =
  "Avançar não confirma o Pix. Se você não recebeu por fora, confira com o cliente antes de seguir.";
