/**
 * O número do pedido como a LOJA o mostra e o cliente o reconhece: os 6
 * últimos caracteres do id, em maiúsculas (painel, PDV, WhatsApp e a tela
 * final do checkout já faziam assim). Só TEXTO EXIBIDO — nunca é enviado a
 * ninguém como identidade (RPC, `external_reference`, Mercado Pago seguem com
 * o id inteiro).
 *
 * Antes, o formulário de pagamento mostrava os 8 PRIMEIROS caracteres
 * ("#c35ce4dd") e a tela final os 6 últimos ("#3884BE"): o cliente não
 * reconhecia o mesmo pedido.
 */
export function numeroDoPedido(id: string | null | undefined): string {
  return (id ?? "").slice(-6).toUpperCase();
}

/**
 * Os dois ids são do mesmo pedido? Compara sem diferença de maiúsculas: o
 * link `/order-details?id=AAAAAAAA-...` preserva a caixa que a pessoa colou, e
 * o banco devolve o uuid em minúsculas. Comparar com `===` fazia um link
 * certo dizer "Pedido não encontrado". Só para COMPARAR — o que vai ao banco
 * segue como veio.
 */
export function mesmoIdDePedido(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
