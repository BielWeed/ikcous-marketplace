// Destino do toque num banner da vitrine.
//
// Fonte única de duas coisas que o painel (AdminBannersView) e a loja
// (BannerCarousel) precisam combinar:
//   - o link que o painel GRAVA para "Página da Loja" e para categoria;
//   - como a loja LÊ o que já está gravado, inclusive banner antigo com o
//     link quebrado (sem precisar migrar dado).
// O que SÓ o painel chama (digitar, avisar, gravar o link, `linkDaCategoria`)
// está em `link-do-banner-no-painel.ts`: este arquivo vai inteiro para a loja.

/** A loja só tem uma "página" de produtos: a Home. Não existe `/produtos`. */
export const LINK_DA_PAGINA_DA_LOJA = "/";

// O navegador descarta tab e quebra de linha em QUALQUER posição do endereço e
// controles/espaços no começo — "java\tscript:" vale "javascript:". Ler o link
// do jeito que ele vai ser lido é o que fecha esses disfarces.
const TAB_E_QUEBRAS = new Set(["\t", "\n", "\r"]);

export function comoONavegadorLe(link: string): string {
  let limpo = "";
  for (const letra of link) {
    if (!TAB_E_QUEBRAS.has(letra)) limpo += letra;
  }
  let inicio = 0;
  while (inicio < limpo.length && limpo.charCodeAt(inicio) <= 0x20) inicio++;
  return limpo.slice(inicio);
}

// "meusite.com/x" digitado sem barra sempre foi gravado como "/meusite.com/x"
// (o painel prefixa a barra). O que tem ":" antes da primeira barra é um
// esquema (`javascript:`, `tel:`), não um caminho — esse não ganha barra.
function pareceTerEsquema(lido: string): boolean {
  const fim = [...lido].findIndex((l) => l === "/" || l === "?" || l === "#");
  return (fim === -1 ? lido : lido.slice(0, fim)).includes(":");
}

// Caminho do app: UMA barra no começo. "//x" e "/\x" o navegador trata como
// OUTRO site, não como caminho.
function caminhoDoApp(lido: string): string | null {
  return lido[1] === "/" || lido[1] === "\\" ? null : lido;
}

/**
 * A regra que painel e loja dividem — sobre o link já lido como o navegador lê:
 * caminho do app (ganha a barra do começo se não tiver, como o painel sempre
 * fez) ou endereço http/https. Qualquer outro esquema, `//outro-site` e
 * `/\outro-site` voltam `null`.
 */
export function caminhoOuHttp(lido: string): string | null {
  if (lido.startsWith("/")) return caminhoDoApp(lido);

  try {
    const { protocol } = new URL(lido);
    return protocol === "http:" || protocol === "https:" ? lido : null;
  } catch {
    // Não é um endereço com esquema válido: sem ":" antes da primeira barra é
    // um caminho do app escrito sem a barra do começo.
    return pareceTerEsquema(lido) ? null : caminhoDoApp(`/${lido}`);
  }
}

// Esquemas que o navegador entrega ao discador, ao e-mail ou a outro app SEM
// rodar código na página. Lista fechada: `javascript:`, `data:`, `vbscript:`,
// `file:`, `blob:`, `intent:`, `ftp:` e qualquer outro NÃO entram. Decide-se
// pelo `protocol` que o `new URL()` já normalizou, nunca pelo texto cru.
const ESQUEMAS_QUE_NAO_RODAM_CODIGO = new Set([
  "tel:",
  "mailto:",
  "sms:",
  "whatsapp:",
]);

/**
 * Só deixa passar o que o banner PODE abrir: um caminho do próprio app, um
 * endereço http/https ou um dos esquemas `tel:`/`mailto:`/`sms:`/`whatsapp:`.
 * Link antigo sem barra (`promocoes/natal`, `?category=Bebidas`, `#ofertas`)
 * é lido como caminho do app, como o painel o gravaria hoje. Qualquer outra
 * coisa — `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `intent:`,
 * `ftp:`, `//outro-site`, `/\outro-site`, vazio — volta `null` e o banner não
 * navega. Devolve o link já lido como o navegador lê (sem tab/quebra de linha).
 */
export function destinoSeguroDoBanner(
  link: string | null | undefined,
): string | null {
  if (typeof link !== "string") return null;
  const lido = comoONavegadorLe(link);
  if (lido === "") return null;

  const doApp = caminhoOuHttp(lido);
  if (doApp !== null) return doApp;

  try {
    return ESQUEMAS_QUE_NAO_RODAM_CODIGO.has(new URL(lido).protocol)
      ? lido
      : null;
  } catch {
    return null;
  }
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
 * Qualquer outro link seguro volta intacto. Link que o banner não pode abrir
 * (ver `destinoSeguroDoBanner`) volta `null`: o banner não navega.
 */
export function destinoDoBanner(
  linkGravado: string | null | undefined,
): string | null {
  const link = destinoSeguroDoBanner(linkGravado);
  if (link === null) return null;

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
