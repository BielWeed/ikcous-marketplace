/**
 * Texto da confirmação de cancelamento NO PAINEL (laudo varredura profunda
 * #2, achado L-1).
 *
 * O problema: cancelar pedido no painel era UM clique no botão X, sem
 * confirmação nenhuma e sem desfazer — enquanto o MESMO cancelamento feito
 * pelo CLIENTE (OrderDetailsView) sempre pediu confirmação com texto honesto
 * por caso. A função pura aqui repete a régua do lado do lojista: a pergunta
 * muda conforme o dinheiro e a mercadoria.
 */
export interface PedidoParaConfirmarCancelamento {
  status?: string | null;
  payment_status?: string | null;
  /** `Order.cancelledAfterShipping`: o pedido já tinha saído para entrega
   * quando foi cancelado (e pode ter sido reativado depois). */
  cancelledAfterShipping?: boolean | null;
  /** `Order.valorEstornado`: devolução já CONCLUÍDA pelo Mercado Pago. */
  valorEstornado?: number | null;
}

const PAGOS = new Set(["pago", "pago_apos_expirar", "recebido_na_entrega"]);

/**
 * L3e (lacunas de pagamento, 02/10/2026): desde 07/09/2026 cancelar um
 * pedido PAGO que ainda NÃO SAIU grava a linha de devolução em
 * `order_refunds` na MESMA transação (`update_order_status_atomic`,
 * migration 20261180000000), e o cron `reconciliar-pagamentos` pede o
 * estorno ao Mercado Pago sozinho a partir dela. A frase antiga ("não
 * devolve o dinheiro automaticamente… combinar a devolução com o cliente")
 * mandava o lojista devolver POR FORA (PIX do banco, dinheiro) — e o
 * cliente recebia duas vezes. O lado do cliente já dizia a verdade
 * (`texto-estorno-do-cliente.ts`).
 *
 * As três condições espelham as do servidor que o painel conhece:
 * status antigo `pending`/`processing`, `payment_status` `pago`/
 * `pago_apos_expirar` (pago na entrega nunca passou pelo Mercado Pago) e
 * NÃO cancelado depois de enviado (pedido enviado, cancelado e reativado
 * continua com a peça na mão do cliente). As que o painel NÃO vê (`paid_at`
 * de dado legado, linha já existente) ficam para a lista "Devolver agora",
 * que lê as linhas de verdade e marca "Devolução em andamento".
 *
 * Quarta condição (rodada 2, G4): `valorEstornado > 0` — já houve devolução
 * CONCLUÍDA neste pedido. O servidor só grava a linha automática se NÃO
 * existir linha `concluido` (`NOT EXISTS ... 'concluido'`), e
 * `valor_estornado` só cresce por `concluir_estorno`, que conclui uma linha:
 * valor estornado > 0 implica linha concluída, logo nenhuma linha nova.
 *
 * `cancelledAfterShipping` ausente conta como "não enviado" de propósito: o
 * erro do outro lado (dizer "devolva você" quando o app já devolve) é o que
 * paga o cliente duas vezes; este lado só deixa o pedido na lista sem o
 * aviso de andamento, à vista do lojista.
 */
const PAGOS_PELO_MERCADO_PAGO = new Set(["pago", "pago_apos_expirar"]);
const AINDA_NAO_SAIU = new Set(["pending", "processing"]);

function cancelarDevolveSozinho(pedido: PedidoParaConfirmarCancelamento) {
  return (
    Boolean(pedido.payment_status) &&
    PAGOS_PELO_MERCADO_PAGO.has(pedido.payment_status as string) &&
    Boolean(pedido.status) &&
    AINDA_NAO_SAIU.has(pedido.status as string) &&
    pedido.cancelledAfterShipping !== true &&
    !((pedido.valorEstornado ?? 0) > 0)
  );
}
// Status reais do app (src/types/index.ts OrderStatus + CHECK do banco):
// quem saiu para entrega está em "shipping". (A 1ª versão usava
// "shipped"/"delivering"/"a_caminho"/"enviado" — ramos mortos, pegos na
// revisão adversária do PR #397.)
const EM_ROTA = new Set(["shipping"]);

export function textoCancelamentoDoPainel(
  pedido: PedidoParaConfirmarCancelamento,
): string {
  // Prazo: o cron roda a cada 10 min e pega a linha depois de 2 min — "em
  // alguns minutos", nunca um número que o código não garante.
  if (cancelarDevolveSozinho(pedido)) {
    return 'Este pedido está PAGO e ainda não saiu para entrega. Ao cancelar, o app pede sozinho ao Mercado Pago, em alguns minutos, que devolva o valor ao cliente. NÃO devolva o dinheiro por outro meio (PIX, dinheiro, transferência): o cliente receberia duas vezes. Se você já devolveu por fora, toque em "Já estornei no Mercado Pago" na lista "Devolver agora" logo depois de cancelar. Cancelar mesmo assim?';
  }
  // Pago que NÃO gera a linha automática (já saiu, reativado depois de
  // enviado, pago na entrega): aqui a frase antiga continua verdadeira.
  if (pedido.payment_status && PAGOS.has(pedido.payment_status)) {
    return 'Este pedido está PAGO. Cancelar não devolve o dinheiro automaticamente: você precisa combinar a devolução com o cliente, e o pedido entra na lista "Devolver agora" até o estorno ser registrado. Cancelar mesmo assim?';
  }
  if (pedido.status && EM_ROTA.has(pedido.status)) {
    return "Este pedido já saiu para entrega. Cancelar agora não traz a mercadoria de volta sozinho — fale com o cliente. Cancelar mesmo assim?";
  }
  return "Tem certeza que deseja cancelar este pedido? O estoque volta para o produto e o cliente é avisado no aplicativo. Cancelar?";
}
