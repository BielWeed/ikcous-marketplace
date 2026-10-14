// A regra de "esta cliente ainda pode voltar a pagar este pedido?", num lugar
// só. Antes ela morava embutida no detalhe do pedido (OrderDetailsView) e o
// cartão "Pedidos em Andamento" do Perfil não a conhecia: o PIX ainda não
// pago aparecia como pedido "Recebido" qualquer, sem o botão de voltar a
// pagar. Os dois lugares leem esta função, então não podem divergir.
//
// Vale para pedido `pending` com cobrança `aguardando` ou `recusado` (a
// cobrança recusada morreu: a edge cria outra com segurança quando a vaga está
// livre) e cliente logada — convidado não paga online (P6). Pago, expirado,
// estornado e cancelado não têm o que retomar. O servidor é quem decide o que
// é seguro: devolve o mesmo QR se a cobrança vive, cria outra se morreu e
// recusa se o pedido não é mais cobrável.
import { paymentStatusKey } from "@/components/admin/orders/OrderStatusBadge";
import type { PaymentStatus } from "@/types";

export function podeRetomarPagamento(pedido: {
  readonly status: string;
  readonly paymentStatus?: PaymentStatus | null;
  readonly logado: boolean;
}): boolean {
  if (!pedido.logado || pedido.status !== "pending") return false;
  const chave = paymentStatusKey(pedido.paymentStatus);
  return chave === "aguardando" || chave === "recusado";
}
