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

// `wa.me`, `www.loja.com.br`, `loja.com:8080`: ao menos dois trechos separados
// por ponto, o último só com letras (a terminação), porta opcional. Sem regex
// aninhada de propósito (backtracking caro, e o eslint a recusa).
function pareceEnderecoDeSite(trecho: string): boolean {
  const [host, porta, ...sobra] = trecho.split(":");
  if (sobra.length > 0) return false;
  if (porta !== undefined && !/^\d{1,5}$/.test(porta)) return false;
  const partes = host.split(".");
  if (partes.length < 2) return false;
  const terminacao = partes[partes.length - 1];
  return (
    /^[a-z]{2,}$/i.test(terminacao) &&
    partes.every((parte) => /^[a-z0-9-]+$/i.test(parte))
  );
}

/**
 * O link que o painel grava a partir do que a lojista digitou.
 *  - `http(s)://...` e `/pagina` ficam como estão;
 *  - o que PARECE endereço de site (`wa.me/55...`, `instagram.com/loja`,
 *    `www.loja.com`: sem espaço, começa por um domínio) ganha `https://`;
 *  - o resto (`ofertas`, `?category=X`, `#topo`) vira caminho da loja, com
 *    `/` na frente, como sempre foi.
 * Esquema perigoso (`javascript:`, `data:`) NÃO é endereço de site: cai no
 * último caso e a `/` na frente o neutraliza (vira caminho, nunca script).
 */
export function linkDigitadoParaGravar(digitado: string): string {
  const link = digitado.trim();
  if (!link) return "";
  if (link.startsWith("/") || /^https?:\/\//i.test(link)) return link;
  const comecoDoEndereco = link.split(/[/?#]/, 1)[0];
  if (!/\s/.test(link) && pareceEnderecoDeSite(comecoDoEndereco)) {
    return `https://${link}`;
  }
  return `/${link}`;
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
