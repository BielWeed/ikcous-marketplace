/**
 * Para onde o toque no aviso do celular leva.
 *
 * Duas decisões puras, sem `self`/DOM, porque rodam no Service Worker de
 * TODAS as clientes (onde um erro não se conserta rápido) e por isso ficam
 * testáveis em tabela (tests/front/alvo-do-aviso.test.ts).
 *
 * 1. `caminhoDoPedidoNoAviso`: o endereço que o painel manda no aviso de
 *    "status do pedido". É o MESMO formato que o app escreve ao abrir um
 *    pedido (`handleNavigate`, App.tsx: `/${tela}?id=${id}`) e que
 *    `syncWithUrl` (App.tsx) lê ao carregar — sem `url`, o aviso caía em "/"
 *    (a vitrine).
 * 2. `decidirToqueNoAviso`: com janelas da loja já abertas, foca a que já está
 *    no destino, navega a que está na mesma tela mas em OUTRO pedido, ou abre
 *    uma nova.
 */

export function caminhoDoPedidoNoAviso(orderId: string): string {
  return `/order-details?id=${encodeURIComponent(orderId)}`;
}

export type AcaoDoToqueNoAviso =
  | { acao: "focar"; indice: number }
  | { acao: "navegar"; indice: number }
  // Painel de pedidos: a janela é só focada e o APP é avisado de qual pedido
  // abrir (ele decide se pode: anotação digitada e não salva segura a troca).
  // Recarregar a janela (`navegar`) apagaria esse texto.
  | { acao: "avisar-app"; indice: number; pedidoId: string }
  | { acao: "abrir" };

/** Tipo da mensagem que o Service Worker manda à janela do painel (e que o app
 * reconhece em `receptor-do-pedido-do-aviso.ts`). Mensagem desconhecida é
 * ignorada por quem não a entende, então SW novo + app velho (e o inverso) não
 * quebram. */
export const TIPO_ABRIR_PEDIDO_DO_AVISO = "ikcous:abrir-pedido-do-aviso";

/** Tela do painel que guarda anotação/rastreio só em estado local. */
const CAMINHO_DOS_PEDIDOS_DO_PAINEL = "/admin-orders";

function lerUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * `alvoHref` é o endereço ABSOLUTO do aviso; `janelasHref`, o endereço de cada
 * janela da loja já aberta. `indice` aponta para a posição em `janelasHref`.
 *
 * - Janela na mesma origem E mesmo caminho E com todos os parâmetros do alvo
 *   (a janela pode ter a mais, como `?source=pwa`): foca. Aviso sem
 *   parâmetros ("/") casa com qualquer janela do caminho — o comportamento de
 *   antes desta função.
 * - Senão, janela no mesmo caminho mas com outros parâmetros (outro pedido):
 *   navega até o alvo. Antes só se dava foco e a cliente ficava vendo o
 *   pedido errado. Exceção: no painel (`/admin-orders?id=X`) NÃO se navega —
 *   `avisar-app` (a ficha aberta pode ter texto não salvo).
 * - Senão: abre uma janela nova (não derruba a tela em que a cliente está).
 */
export function decidirToqueNoAviso(
  alvoHref: string,
  janelasHref: readonly string[],
): AcaoDoToqueNoAviso {
  const alvo = lerUrl(alvoHref);
  if (!alvo) return { acao: "abrir" };

  let navegavel = -1;
  for (const [i, href] of janelasHref.entries()) {
    const janela = lerUrl(href);
    if (
      !janela ||
      janela.origin !== alvo.origin ||
      janela.pathname !== alvo.pathname
    ) {
      continue;
    }
    let jaNoDestino = true;
    for (const [chave, valor] of alvo.searchParams) {
      if (!janela.searchParams.getAll(chave).includes(valor)) {
        jaNoDestino = false;
        break;
      }
    }
    if (jaNoDestino) return { acao: "focar", indice: i };
    if (navegavel === -1) navegavel = i;
  }
  if (navegavel === -1) return { acao: "abrir" };
  const pedidoId = alvo.searchParams.get("id");
  if (alvo.pathname === CAMINHO_DOS_PEDIDOS_DO_PAINEL && pedidoId) {
    return { acao: "avisar-app", indice: navegavel, pedidoId };
  }
  return { acao: "navegar", indice: navegavel };
}
