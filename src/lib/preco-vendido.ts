// O PREÇO QUE A TELA COBRA = O PREÇO QUE O SERVIDOR CONFERE (laudo
// caça-bugs 31/08, menor E). Variação com `priceOverride` ZERO era
// cobrada pelo preço cheio do produto porque as quatro telas escreviam
// `priceOverride || product.price` — e `||` trata 0 como ausência. Zero é
// um PREÇO legítimo (brinde, item de custo zerado), não "não informei": o
// servidor (`create_marketplace_order_v23/v24`) usa
// `COALESCE(v.price_override, p.preco_venda)`, que só cai no preço do
// produto quando o override é NULL — e recusava o pedido com "os valores
// mudaram" enquanto o carrinho mostrava outro total.
//
// Aqui mora a regra única do cliente; as cópias em CartContext (cartTotal),
// CartView, CheckoutView e CartItemsList foram aposentadas por esta
// função. O teste `preco-vendido.test.ts` é o assassino do mutante:
// voltar para `||` quebra o caso do zero.

type ProdutoComPreco = { price: number };
type VarianteComOverride = { priceOverride?: number | null } | null | undefined;

export function precoVendido(
  produto: ProdutoComPreco,
  variante: VarianteComOverride,
): number {
  return variante?.priceOverride ?? produto.price;
}
