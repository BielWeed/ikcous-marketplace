// Cópias por produto no aparelho (recomendações, avaliações, perguntas): uma
// chave nova para CADA produto que a pessoa abre, mostrada antes de a rede
// responder. São só um atalho — o servidor tem tudo — mas elas nunca saíam do
// aparelho: o `localStorage` (~5 MB) enchia com o tempo e, cheio, o carrinho do
// visitante, que só mora ali, deixava de ser salvo em silêncio.
//
// Duas regras, num lugar só para os três caches não divergirem:
//
// 1. TETO. Cada cache guarda no máximo `LIMITE_DE_COPIAS` produtos; ao passar,
//    saem as mais antigas. A ordem de uso vive numa chave pequena à parte
//    (`ikcous_lru:<prefixo>`); cópia que já estava no aparelho antes dela (sem
//    registro) conta como a mais antiga e sai primeiro.
// 2. COTA CHEIA NÃO É DEFEITO DO CACHE. Se gravar falhar, o cache libera as
//    próprias cópias e tenta de novo; e o carrinho, se não conseguir gravar,
//    libera TODAS as cópias (`liberarCopiasPorProduto`) e tenta de novo. Cópia
//    se refaz com uma ida à rede; carrinho do visitante, não.
export const PREFIXO_DE_RECOMENDACOES = "ikcous_recs_v2_cache_";
export const PREFIXO_DE_AVALIACOES = "ikcous_reviews_cache_";
export const PREFIXO_DE_PERGUNTAS = "ikcous_questions_cache_";
// Cópia de recomendações da versão antiga: ninguém mais a lê (ver o hook).
const PREFIXO_DE_RECOMENDACOES_V1 = "ikcous_recs_cache_";

const PREFIXOS = [
  PREFIXO_DE_RECOMENDACOES,
  PREFIXO_DE_AVALIACOES,
  PREFIXO_DE_PERGUNTAS,
  PREFIXO_DE_RECOMENDACOES_V1,
] as const;

/** Quantos produtos cada cache guarda no aparelho. */
export const LIMITE_DE_COPIAS = 20;

const chaveDoRegistro = (prefixo: string) => `ikcous_lru:${prefixo}`;

/** As chaves que existem no aparelho com este prefixo (vazio se não der para ler). */
function chavesComPrefixo(prefixo: string): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const total = localStorage.length;
    if (typeof total !== "number") return [];
    const achadas: string[] = [];
    for (let i = 0; i < total; i++) {
      const chave = localStorage.key(i);
      if (chave?.startsWith(prefixo)) achadas.push(chave);
    }
    return achadas;
  } catch {
    return [];
  }
}

function lerRegistro(prefixo: string): string[] {
  try {
    const lista = JSON.parse(
      localStorage.getItem(chaveDoRegistro(prefixo)) ?? "[]",
    );
    return Array.isArray(lista)
      ? lista.filter((c): c is string => typeof c === "string")
      : [];
  } catch {
    return [];
  }
}

function apagar(chave: string) {
  try {
    localStorage.removeItem(chave);
  } catch {
    // Sem acesso ao armazenamento não há o que apagar.
  }
}

/**
 * Grava a cópia de UM produto (`chave` completa, com o prefixo) respeitando o
 * teto. Lança se, mesmo depois de liberar as cópias do próprio cache, a
 * gravação falhar: quem chama já trata (log), como antes.
 */
export function gravarCopiaPorProduto(
  prefixo: string,
  chave: string,
  valor: string,
  limite: number = LIMITE_DE_COPIAS,
): void {
  const existentes = chavesComPrefixo(prefixo).filter((c) => c !== chave);
  const noRegistro = new Set(lerRegistro(prefixo));
  // Sem registro primeiro (as mais velhas), depois por ordem de uso.
  const ordem = [
    ...existentes.filter((c) => !noRegistro.has(c)),
    ...[...noRegistro].filter((c) => existentes.includes(c)),
  ];
  // O que está sendo gravado ocupa uma vaga: sobram `limite - 1` das outras.
  const excesso = ordem.length - Math.max(limite - 1, 0);
  for (const velha of ordem.slice(0, Math.max(excesso, 0))) apagar(velha);
  let restantes = ordem.slice(Math.max(excesso, 0));

  try {
    localStorage.setItem(chave, valor);
  } catch (primeiroErro) {
    // Cota cheia (ou qualquer recusa): solta as cópias deste cache e tenta uma
    // vez mais. Sem cópia para soltar, o espaço não é deste cache: o erro volta.
    if (restantes.length === 0) throw primeiroErro;
    for (const velha of restantes) apagar(velha);
    restantes = [];
    localStorage.setItem(chave, valor);
  }
  try {
    localStorage.setItem(
      chaveDoRegistro(prefixo),
      JSON.stringify([...restantes, chave]),
    );
  } catch {
    // O registro é só a ordem de uso: sem ele, as cópias contam como antigas.
  }
}

/**
 * Apaga TODAS as cópias por produto (e os registros de ordem) para dar lugar
 * ao que não se refaz. Devolve quantas chaves saíram.
 */
export function liberarCopiasPorProduto(): number {
  let apagadas = 0;
  for (const prefixo of PREFIXOS) {
    for (const chave of chavesComPrefixo(prefixo)) {
      apagar(chave);
      apagadas += 1;
    }
    apagar(chaveDoRegistro(prefixo));
  }
  return apagadas;
}
