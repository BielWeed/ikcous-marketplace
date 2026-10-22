// Classifica o pedido pelo jeito que ele chega (ou não chega) ao cliente.
// A ficha do pedido no painel usa SÓ esta função para decidir o que mostrar:
// venda de balcão não tem endereço, frete nem rastreio; retirada e entrega
// local (a própria loja entrega) não têm código dos Correios.
//
// Prioridade: balcão > retirada > entrega local > envio.

import type { Order } from "@/types";

export type TipoDeEntregaDoPedido =
  | "balcao"
  | "retirada"
  | "entrega-local"
  | "envio";

export function tipoDeEntregaDoPedido(
  order: Pick<Order, "canal" | "retiradaNaLoja" | "shippingOptionId">,
): TipoDeEntregaDoPedido {
  if (order.canal === "presencial") return "balcao";
  if (order.retiradaNaLoja) return "retirada";
  if (order.shippingOptionId === "local-delivery") return "entrega-local";
  return "envio";
}
