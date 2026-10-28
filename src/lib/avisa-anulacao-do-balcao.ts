// Quem mostra pedido (a lista do painel e os números do topo de Pedidos) assina
// aqui para mudar na hora que uma venda do balcão é anulada, sem esperar o
// tempo real — que pode atrasar ou se perder. Só o SUCESSO avisa (quem avisa é
// `useAnularVendaDoBalcao`). Arquivo à parte e minúsculo: `useOrders` também
// vai para a loja, e não pode arrastar o hook do painel junto.
const ouvintes = new Set<(orderId: string) => void>();

export function aoAnularVenda(ouvinte: (orderId: string) => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function avisarAnulacao(orderId: string): void {
  for (const ouvinte of ouvintes) ouvinte(orderId);
}
