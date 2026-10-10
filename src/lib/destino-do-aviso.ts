/**
 * Destino do aviso (Avisar clientes): para onde o cliente vai ao tocar na
 * notificação. A tela escolhe o destino por LISTA e este arquivo traduz a
 * escolha em URL (`urlDoDestino`) e a URL de um modelo pronto de volta em
 * escolha (`destinoDaUrl`).
 *
 * O contrato é a URL: ela vai para o aviso dentro do app (`action_url`), para
 * o push e para o histórico. Os valores aqui são os que a tela já enviava
 * antes de virarem função pura — `tests/front/destino-do-aviso.test.ts` prende
 * a tabela com as URLs literais. Destino novo NÃO nasce aqui (decisão P3 do
 * painel simples): é mudança de produto, não de tela.
 */

export type TipoDeDestino =
  | "home"
  | "search"
  | "cart"
  | "favorites"
  | "orders"
  | "profile"
  | "product"
  | "custom";

/**
 * A URL que o aviso carrega para o destino escolhido.
 *
 * - telas da lista: URL fixa (id e caminho que sobraram são ignorados);
 * - produto: `/product-detail?id=<id>`, ou `/product-detail` se ainda não há id;
 * - página manual (`custom`): o caminho exatamente como digitado;
 * - tipo desconhecido: página inicial.
 */
export function urlDoDestino(
  tipo: string,
  idDoProduto: string,
  caminho: string,
): string {
  switch (tipo) {
    case "search":
      return "/search";
    case "cart":
      return "/cart";
    case "favorites":
      return "/favorites";
    case "orders":
      return "/orders";
    case "profile":
      return "/profile";
    case "product":
      return idDoProduto
        ? `/product-detail?id=${idDoProduto}`
        : "/product-detail";
    case "custom":
      return caminho;
    default:
      // "home" e qualquer tipo desconhecido.
      return "/";
  }
}

export interface DestinoDaUrl {
  readonly tipo: TipoDeDestino;
  /** Só no destino `product`: o id lido da URL (pode ser vazio). */
  readonly idDoProduto: string | null;
  /** Só no destino `custom`: a URL inteira, para o campo de caminho manual. */
  readonly caminho: string | null;
}

/**
 * O inverso: que destino uma URL representa. Uma URL de modelo pronto
 * (`/search`, `/cart`, `/profile`) escolhe a opção da lista; o formato antigo
 * `/product/<id>` ainda vale como produto. O que não for reconhecido é página
 * manual e devolve o caminho inteiro — é aí que a tela abre o "Avançado".
 */
export function destinoDaUrl(url: string): DestinoDaUrl {
  const sem = (tipo: TipoDeDestino): DestinoDaUrl => ({
    tipo,
    idDoProduto: null,
    caminho: null,
  });
  if (url === "/" || url === "" || url === "/home") return sem("home");
  if (url === "/search") return sem("search");
  if (url === "/cart") return sem("cart");
  if (url === "/favorites") return sem("favorites");
  if (url === "/orders") return sem("orders");
  if (url === "/profile") return sem("profile");
  if (url.startsWith("/product-detail?id=") || url.startsWith("/product/")) {
    const idDoProduto = url.includes("?id=")
      ? url.split("?id=")[1] || ""
      : url.split("/product/")[1] || "";
    return { tipo: "product", idDoProduto, caminho: null };
  }
  return { tipo: "custom", idDoProduto: null, caminho: url };
}
