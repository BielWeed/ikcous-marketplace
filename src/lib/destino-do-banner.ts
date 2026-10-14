// Destino do toque num banner da vitrine.
//
// Fonte única de duas coisas que o painel (AdminBannersView) e a loja
// (BannerCarousel) precisam combinar:
//   - o link que o painel GRAVA para "Página da Loja" e para categoria;
//   - como a loja LÊ o que já está gravado, inclusive banner antigo com o
//     link quebrado (sem precisar migrar dado).

/** A loja só tem uma "página" de produtos: a Home. Não existe `/produtos`. */
export const LINK_DA_PAGINA_DA_LOJA = "/";

/** Link de categoria com o nome codificado (&, +, # e espaço seguros). */
export function linkDaCategoria(nome: string): string {
  return `/?category=${encodeURIComponent(nome)}`;
}

const CATEGORIA_CRUA = /^\/\?category=([\s\S]*)$/;
const PARAMETRO_DE_VERDADE = /^[\w.-]+=/;

// Já está codificado quando não sobrou nada que o endereço trataria como
// separador (&, #, +, espaço) e todo "%" abre um par hexadecimal.
function pareceCodificado(trecho: string): boolean {
  return !/[\s+#&]/.test(trecho) && !/%(?![0-9A-Fa-f]{2})/.test(trecho);
}

/**
 * Corrige, na hora da leitura, o que versões anteriores do painel gravaram:
 *  - `/produtos` (endereço que a loja não tem) vira a Home;
 *  - `/?category=Cama & Banho` (nome cru) ganha a codificação que faltava.
 *    O texto depois de `category=` é o nome inteiro, salvo trechos
 *    `chave=valor` depois de um "&", que seguem como parâmetros.
 * Qualquer outro link volta intacto.
 */
export function destinoDoBanner(link: string): string {
  const caminho = link.split(/[?#]/, 1)[0].toLowerCase();
  if (caminho === "/produtos" || caminho === "/produtos/") {
    return LINK_DA_PAGINA_DA_LOJA;
  }

  const crua = CATEGORIA_CRUA.exec(link);
  if (!crua) return link;

  const [primeira, ...demais] = crua[1].split("&");
  const inicioDosParametros = demais.findIndex((p) =>
    PARAMETRO_DE_VERDADE.test(p),
  );
  const doNome =
    inicioDosParametros === -1 ? demais : demais.slice(0, inicioDosParametros);
  const parametros =
    inicioDosParametros === -1 ? [] : demais.slice(inicioDosParametros);
  const nome = [primeira, ...doNome].join("&");
  if (!nome) return link;

  const resto = parametros.join("&");
  const nomeCodificado = pareceCodificado(nome)
    ? nome
    : encodeURIComponent(nome);
  return `/?category=${nomeCodificado}${resto ? `&${resto}` : ""}`;
}
