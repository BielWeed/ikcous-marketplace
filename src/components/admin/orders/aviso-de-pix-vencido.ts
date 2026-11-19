import type { Order } from "@/types";

// Prazo inicial da reserva online (20260807000000). Só para leituras sem
// o vencimento gravado da cobrança.
const PRAZO_INICIAL_DO_PIX_MS = 30 * 60_000;

export function aguardaPixOnline(order: Order): boolean {
  return (
    order.canal !== "presencial" &&
    order.paymentStatus === "aguardando" &&
    order.paymentMethod === "online" &&
    order.metodoOnline === "pix"
  );
}

export function avisoDePixVencido(order: Order, agora: number): string | null {
  if (
    (order.status !== "processing" && order.status !== "shipping") ||
    !aguardaPixOnline(order)
  ) {
    return null;
  }
  const vencimento = order.expiraEm
    ? Date.parse(order.expiraEm)
    : Date.parse(order.createdAt) + PRAZO_INICIAL_DO_PIX_MS;
  if (!Number.isFinite(vencimento) || vencimento >= agora) return null;

  return "O Pix deste pedido venceu e ainda não consta como pago. O estoque e, se usado, o cupom continuam reservados. Se você recebeu por fora, siga com o pedido. Se não, use Cancelar pedido para liberar a reserva.";
}

export const AVISO_DE_RESERVA_AO_AVANCAR_PIX =
  "O estoque e o cupom ficam reservados até você cancelar o pedido ou o Pix ser pago.";
