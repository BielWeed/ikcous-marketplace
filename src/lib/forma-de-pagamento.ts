// Um rótulo SÓ para a forma de pagamento de um pedido (defeito D4 da
// investigação do balcão, 28/09/2026). Antes, cada tela dizia uma coisa: a
// planilha chamava `card` de "Crédito Seguro" e `online` de "Outro"; a ficha
// do pedido chamava `card` de "Cartão de crédito". O mesmo `payment_method`
// quer dizer coisas diferentes no site e no balcão — por isso o canal entra
// na conta. É só TEXTO de exibição: o valor gravado em
// `marketplace_orders.payment_method` e o filtro de quais pedidos aparecem
// não passam por aqui.
//
// A edge tem a sua própria tabela, em português sem acento, para o e-mail e o
// WhatsApp (`supabase/functions/_shared/pedido.ts`, `rotuloDoPagamento`): é
// outro runtime (Deno) e outro registro de voz (fala com o cliente). As duas
// concordam no que importa — cartão no balcão é "na maquininha", cartão do
// site é "na entrega".

export interface FormaDoPedido {
  readonly paymentMethod: string | null | undefined;
  /** `marketplace_orders.metodo_online` (pix | credito | debito). A tela de
   * pedidos ainda não o carrega: ausente = "não sei qual foi". */
  readonly metodoOnline?: string | null;
  /** Ramifica por `presencial`, nunca por `online` — ausente é site. */
  readonly canal?: string | null;
}

function rotuloDoPagamentoPeloSite(metodoOnline: string | null | undefined) {
  switch (metodoOnline) {
    case "pix":
      return "PIX pelo site";
    case "credito":
      return "Cartão de crédito pelo site";
    case "debito":
      return "Cartão de débito pelo site";
    default:
      // Sem `metodo_online` não dá para afirmar PIX: com o cartão ligado na
      // loja, "PIX pelo site" mentiria. "Pagamento pelo site" é verdade
      // sempre — e já não é o "Outro" que não dizia nada.
      return "Pagamento pelo site";
  }
}

export function rotuloDaFormaDoPedido(pedido: FormaDoPedido): string {
  const noBalcao = pedido.canal === "presencial";
  switch (pedido.paymentMethod) {
    case "cash":
      return "Dinheiro";
    case "pix":
      return "PIX Instantâneo";
    case "card":
      return noBalcao ? "Cartão na maquininha" : "Cartão na entrega";
    case "online":
      return rotuloDoPagamentoPeloSite(pedido.metodoOnline);
    default:
      return "Outro";
  }
}
