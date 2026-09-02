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
}

const PAGOS = new Set(["pago", "pago_apos_expirar", "recebido_na_entrega"]);
const EM_ROTA = new Set(["shipped", "delivering", "a_caminho", "enviado"]);

export function textoCancelamentoDoPainel(
  pedido: PedidoParaConfirmarCancelamento,
): string {
  if (pedido.payment_status && PAGOS.has(pedido.payment_status)) {
    return 'Este pedido está PAGO. Cancelar não devolve o dinheiro automaticamente: você precisa combinar a devolução com o cliente, e o pedido entra na lista "Devolver agora" até o estorno ser registrado. Cancelar mesmo assim?';
  }
  if (pedido.status && EM_ROTA.has(pedido.status)) {
    return "Este pedido já saiu para entrega. Cancelar agora não traz a mercadoria de volta sozinho — fale com o cliente. Cancelar mesmo assim?";
  }
  return "Tem certeza que deseja cancelar este pedido? O estoque volta para o produto e o cliente é avisado no aplicativo. Cancelar?";
}
