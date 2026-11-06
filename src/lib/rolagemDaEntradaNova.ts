/**
 * Abrir um produto ou um pedido por toque/link (entrada NOVA no histórico)
 * começa no topo.
 * Sem isto, a posição que o `onScroll` guardou na visita anterior era
 * restaurada: a cliente reabria o produto e caía em Avaliações/Perguntas, sem
 * ver foto, preço e botão de comprar. No pedido é pior: a tela guarda a
 * posição sob UMA chave só (`order-details`, sem o id), então abrir o pedido A,
 * rolar ao fim, voltar à lista e abrir o pedido B fazia o B nascer onde o A
 * parou.
 * Voltar/Avançar do navegador (popstate) NÃO chama isto e continua
 * restaurando a posição.
 */
export function esquecerRolagemDoProdutoAberto(
  posicoes: Record<string, number>,
  view: string,
  id: string | undefined,
): void {
  if (!id) return;
  if (view === "product-detail") {
    delete posicoes[`product-detail-${id}`];
  } else if (view === "order-details") {
    Reflect.deleteProperty(posicoes, "order-details");
  }
}
