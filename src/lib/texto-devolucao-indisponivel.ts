import type { Order } from "@/types";

/**
 * Pedido ENTREGUE de pagamento na entrega/retirada em que a lojista ainda
 * não marcou o recebimento ("Ainda não" na pergunta "Recebeu o pagamento?"
 * deixa `payment_status` em branco). O servidor recusa a devolução desse
 * pedido (`devolucao_elegibilidade` / `solicitar_devolucao`, "Achado B") com
 * "Este pedido não tem pagamento a devolver.", e para a cliente isso soa como
 * "a loja ficou com o meu dinheiro". A regra do servidor NÃO muda aqui: só a
 * frase da tela, para uma verdadeira e acionável — o recebimento é registrado
 * pela loja, e é isso que libera o pedido de devolução.
 */
const TEXTO_AGUARDANDO_A_LOJA_REGISTRAR =
  "A loja ainda não registrou o pagamento deste pedido. Peça a ela para registrar e a devolução ou troca é liberada aqui.";

/**
 * Decide pelo ESTADO do pedido que a tela já tem (entregue + não pago pelo
 * site + pagamento em branco), nunca comparando o texto do servidor. Fora
 * desse estado — pago online, pagamento aguardando/recusado/expirado/
 * estornado, pedido não entregue, `paymentStatus` ausente no cache velho
 * (`undefined`) — vale a frase do servidor, que fala a verdade de cada um.
 */
export function motivoDaDevolucaoIndisponivel(
  motivoDoServidor: string,
  pedido: Pick<Order, "status" | "paymentMethod" | "paymentStatus">,
): string {
  const semRecebimentoMarcado =
    pedido.status === "delivered" &&
    pedido.paymentMethod !== "online" &&
    pedido.paymentStatus === null;
  return semRecebimentoMarcado
    ? TEXTO_AGUARDANDO_A_LOJA_REGISTRAR
    : motivoDoServidor;
}
