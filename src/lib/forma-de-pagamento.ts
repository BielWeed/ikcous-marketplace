// Um rótulo SÓ para a forma de pagamento de um pedido (achado D4 da
// investigação de 28/09/2026, docs/superpowers/specs/2026-09-28-balcao-pix-investigacao.md).
// Antes: a ficha dizia "Cartão de crédito" para a maquininha e "Dinheiro
// Espécie" para forma desconhecida; o CSV dizia "Crédito Seguro" e "Outro"
// para todo pedido pago pelo app. O mesmo `payment_method` quer dizer coisas
// diferentes no site e no balcão — por isso o canal entra na conta.

export interface FormaDoPedido {
  readonly paymentMethod: string | null | undefined;
  readonly metodoOnline?: string | null;
  readonly canal?: string | null;
}

export function rotuloDaFormaDoPedido(pedido: FormaDoPedido): string {
  const noBalcao = pedido.canal === "presencial";
  switch (pedido.paymentMethod) {
    case "cash":
      return "Dinheiro";
    case "pix":
      return noBalcao ? "PIX na chave da loja" : "PIX na entrega";
    case "card":
      return noBalcao ? "Cartão na maquininha" : "Cartão na entrega";
    case "online":
      if (pedido.metodoOnline === "pix") {
        return noBalcao ? "PIX com QR no balcão" : "PIX pelo app";
      }
      if (pedido.metodoOnline === "credito")
        return "Cartão de crédito pelo app";
      if (pedido.metodoOnline === "debito") return "Cartão de débito pelo app";
      return "Pagamento pelo app";
    default:
      return "Outro";
  }
}
