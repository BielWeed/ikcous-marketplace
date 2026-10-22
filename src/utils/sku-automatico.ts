/**
 * Código interno (SKU) AUTOMÁTICO do produto.
 *
 * É só um texto gerado no cliente, no formato que o formulário e o banco já
 * aceitam (letras, números e hífen — ver a validação de `product-sku` em
 * AdminProductFormView). Nada de servidor novo: o código do PRODUTO
 * (`produtos.codigo`) não tem índice único e pode repetir; o de cada VARIAÇÃO
 * (`product_variants.sku`) é único na loja inteira, e quem confere isso é a
 * grade (`primeiroSkuEmColisao`) e o salvar (`conferirSkusDasVariacoes`).
 *
 * Formato: `<3 letras da categoria>-<4 caracteres>`, ex.: `CAM-7K3F`. O
 * sufixo vem de um alfabeto sem 0/O/1/I, para o código ser fácil de ler e de
 * ditar por telefone.
 */

export const ALFABETO_DO_CODIGO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const TAMANHO_DO_PREFIXO = 3;
const TAMANHO_DO_SUFIXO = 4;
const PREFIXO_PADRAO = "PRD";
const TENTATIVAS_PARA_ACHAR_LIVRE = 25;

/** Só A-Z e 0-9, sem acento, em maiúsculas. */
const soLetrasENumeros = (texto: string): string =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

/**
 * As 3 primeiras letras da categoria; sem categoria (ou sem letra nela), as da
 * primeira palavra do nome; sem nada, `PRD`.
 */
export function prefixoDoCodigo(categoria: string, nome: string): string {
  const daCategoria = soLetrasENumeros(categoria).slice(0, TAMANHO_DO_PREFIXO);
  if (daCategoria !== "") return daCategoria;
  const primeiraPalavra = nome.trim().split(/\s+/)[0] ?? "";
  const doNome = soLetrasENumeros(primeiraPalavra).slice(0, TAMANHO_DO_PREFIXO);
  return doNome !== "" ? doNome : PREFIXO_PADRAO;
}

/** Um índice aleatório em [0, limite). `crypto` quando existe, senão `Math.random`. */
function indiceAleatorio(limite: number): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const buffer = new Uint32Array(1);
    c.getRandomValues(buffer);
    return (buffer[0] ?? 0) % limite;
  }
  return Math.floor(Math.random() * limite);
}

/**
 * 4 caracteres do alfabeto legível. `sortear` devolve um índice (qualquer
 * inteiro; é reduzido ao tamanho do alfabeto) — existe para o teste fixar o
 * resultado.
 */
export function sufixoDoCodigo(
  sortear: () => number = () => indiceAleatorio(ALFABETO_DO_CODIGO.length),
): string {
  let sufixo = "";
  for (let i = 0; i < TAMANHO_DO_SUFIXO; i += 1) {
    sufixo += ALFABETO_DO_CODIGO[sortear() % ALFABETO_DO_CODIGO.length];
  }
  return sufixo;
}

export function montarCodigoAutomatico(
  prefixo: string,
  sufixo: string,
): string {
  return `${prefixo}-${sufixo}`;
}

/**
 * Um sufixo cujo código completo ainda não está em `ocupados` (compara sem
 * diferenciar caixa). Tenta algumas vezes; se tudo estiver ocupado devolve o
 * último sorteio mesmo assim — o código do produto pode repetir e o das
 * variações é conferido depois, com aviso em português.
 */
export function sufixoLivre(
  prefixo: string,
  ocupados: ReadonlyArray<string>,
  gerar: () => string = () => sufixoDoCodigo(),
): string {
  const usados = new Set(ocupados.map((codigo) => codigo.trim().toUpperCase()));
  let sufixo = gerar();
  for (let i = 1; i < TENTATIVAS_PARA_ACHAR_LIVRE; i += 1) {
    if (!usados.has(montarCodigoAutomatico(prefixo, sufixo))) return sufixo;
    sufixo = gerar();
  }
  return sufixo;
}
