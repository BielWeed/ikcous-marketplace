import { pedidoSemValorAPagar } from "@/lib/forma-de-pagamento";
import type { Order } from "@/types";

/** A mesma decisão para o papel e a mensagem ao entregador, sem efeitos colaterais. */
export function situacaoDoPagamentoNaEntrega(order: Order) {
  const formas = new Map([
    ["pix", "Pix"],
    ["card", "Cartão"],
    ["cash", "Dinheiro"],
  ]);
  const forma = formas.get(order.paymentMethod);
  const valor = order.total.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const pago =
    ["pago", "pago_apos_expirar", "recebido_na_entrega"].includes(
      order.paymentStatus ?? "",
    ) || !!order.pagamentoRecebidoEm;
  const situacao =
    order.paymentStatus === "estornado"
      ? "estornado"
      : pedidoSemValorAPagar(order)
        ? "sem_valor"
        : pago
          ? "pago"
          : forma
            ? "cobrar"
            : "pendente";
  return { situacao, forma, valor } as const;
}
