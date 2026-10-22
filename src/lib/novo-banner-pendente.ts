// Pedido de "Novo banner" feito pelo botao do cabecalho do painel.
//
// A tela de Banners carrega sob demanda e so abre o editor com a lista ja
// carregada. Um clique que chega antes disso ficaria no vazio, entao o pedido
// fica registrado aqui por pouco tempo e a tela o consome quando puder.
export const EVENTO_NOVO_BANNER = "admin:open-new-banner-dialog";

// Passou disso, o pedido esta velho: nao abre um dialogo "fantasma" depois.
export const VALIDADE_PEDIDO_NOVO_BANNER_MS = 8000;

let pedidoEm: number | null = null;

export function pedirNovoBanner(): void {
  pedidoEm = Date.now();
  window.dispatchEvent(new CustomEvent(EVENTO_NOVO_BANNER));
}

/** Devolve true uma unica vez se ha pedido pendente e ainda valido; limpa. */
export function consumirPedidoDeNovoBanner(): boolean {
  if (pedidoEm === null) return false;
  const valido = Date.now() - pedidoEm <= VALIDADE_PEDIDO_NOVO_BANNER_MS;
  pedidoEm = null;
  return valido;
}
