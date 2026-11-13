import type { View } from "@/types";

/**
 * Chegar numa tela pelo aviso do lojista ("perguntas esperando resposta",
 * "avaliação sem resposta") tem de mostrar o que o aviso promete. Essas telas
 * guardam filtro, busca e página no aparelho, e um filtro velho esconderia a
 * lista prometida. Aqui moram as chaves guardadas de cada tela e o aviso de
 * "chegou por aviso":
 * - tela ainda por abrir: apagar a chave faz ela abrir nos padrões;
 * - tela já aberta em segundo plano (as telas do painel ficam montadas): o
 *   evento faz ela mesma zerar o estado, pelos mesmos setters do "limpar".
 */
const CHAVES_GUARDADAS = new Map<View, readonly string[]>([
  ["admin-qa", ["admin_qa_filter", "admin_qa_page", "admin_qa_search_query"]],
  [
    "admin-reviews",
    [
      "admin_reviews_page",
      "admin_reviews_search_query",
      "admin_reviews_rating_filter",
      "admin_reviews_status_filter",
    ],
  ],
]);

const EVENTO = "ikcous:chegada-por-aviso";

/**
 * O que o aviso pede além de zerar: a fila "Em moderação" ou só as "Sem resposta"
 * das Avaliações (um dos dois; se vierem os dois, vale a moderação).
 */
export interface OpcoesDeChegada {
  soEmModeracao?: true;
  soSemResposta?: true;
}

interface DetalheDaChegada {
  view: View;
  opcoes: OpcoesDeChegada;
}

export function limparGuardadosAoChegarPorAviso(
  view: View,
  opcoes: OpcoesDeChegada = {},
): void {
  if (typeof window === "undefined") return;
  for (const chave of CHAVES_GUARDADAS.get(view) ?? []) {
    try {
      window.localStorage.removeItem(chave);
    } catch {
      // Sem armazenamento: a tela já abre nos padrões.
    }
  }
  // Tela ainda por abrir: o filtro de moderação nasce do armazenamento (mesma
  // chave e formato do `useLocalStorage` da tela).
  if (
    view === "admin-reviews" &&
    (opcoes.soEmModeracao || opcoes.soSemResposta)
  ) {
    try {
      window.localStorage.setItem(
        "admin_reviews_status_filter",
        JSON.stringify(opcoes.soEmModeracao ? "pendente" : "sem_resposta"),
      );
    } catch {
      // Sem armazenamento: abre em "todas", com a avaliação na lista.
    }
  }
  window.dispatchEvent(
    new CustomEvent<DetalheDaChegada>(EVENTO, { detail: { view, opcoes } }),
  );
}

/** Escuta a chegada por aviso à tela `view`; devolve o cancelamento. */
export function aoChegarPorAviso(
  view: View,
  aoChegar: (opcoes: OpcoesDeChegada) => void,
) {
  if (typeof window === "undefined") return () => {};
  const ouvinte = (evento: Event) => {
    const detalhe = (evento as CustomEvent<DetalheDaChegada>).detail;
    if (detalhe.view === view) aoChegar(detalhe.opcoes);
  };
  window.addEventListener(EVENTO, ouvinte);
  return () => window.removeEventListener(EVENTO, ouvinte);
}
