import { lerPrazoDoPixEmMs, prazoDoPixPassou } from "@/lib/prazo-do-pix";
import { tipoDeEntregaDoPedido } from "@/lib/tipo-de-entrega-do-pedido";
import type { Order } from "@/types";

export function aguardaPixOnline(order: Order): boolean {
  const tipoDeEntrega = tipoDeEntregaDoPedido(order);
  return (
    tipoDeEntrega !== "balcao" &&
    tipoDeEntrega !== "retirada" &&
    order.paymentStatus === "aguardando" &&
    order.paymentMethod === "online" &&
    order.metodoOnline === "pix"
  );
}

export function avisoDePixVencido(order: Order, agora: number): string | null {
  if (
    (order.status !== "processing" && order.status !== "shipping") ||
    !aguardaPixOnline(order) ||
    !prazoDoPixPassou(lerPrazoDoPixEmMs(order.expiraEm), agora)
  ) {
    return null;
  }

  return "O Pix deste pedido venceu pelo horário previsto, mas o pagamento ainda não consta. Se não recebeu por fora, confira com o cliente. Se decidir desistir, use Cancelar pedido.";
}

export const AVISO_DE_RESERVA_AO_AVANCAR_PIX =
  "Avançar não confirma o Pix. Se você não recebeu por fora, confira com o cliente antes de seguir.";
