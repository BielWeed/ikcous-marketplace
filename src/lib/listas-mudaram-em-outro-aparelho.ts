// Caça 27/11 — ajustes da loja em duas abas ou dois aparelhos. Três listas da
// configuração são gravadas INTEIRAS a partir da cópia que a tela tem em
// memória (as vitrines da Home, as formas de pagamento na entrega e as listas
// da política de devolução). Com a tela velha, um aparelho regravava a lista e
// apagava o que o outro tinha acabado de mudar.
//
// Desde a migration 20261643000000, quem grava manda também a lista que VIU
// (`vistos`): `upsert_store_config` e `salvar_politica_de_devolucao` recusam
// com o código abaixo, sem gravar nada, quando ela já não é a do banco. O
// DETAIL da recusa é o nome da coluna. As frases moram aqui, na tela (não no
// servidor), para valer igual em qualquer versão do banco.

/** SQLSTATE da recusa "a lista mudou em outro aparelho" (20261643000000). */
export const CODIGO_LISTA_MUDOU = "LST01";

const AVISO_DAS_VITRINES =
  "As vitrines foram mudadas em outro aparelho. Atualizamos a lista — confira e faça a mudança de novo.";
const AVISO_DAS_FORMAS =
  "As formas de pagamento na entrega foram mudadas em outro aparelho. Atualizamos a lista — confira e toque de novo.";
export const AVISO_DA_POLITICA_MUDOU =
  "A política de trocas foi mudada em outro aparelho. Conferimos de novo e mantivemos o que você mudou — revise e salve outra vez.";
const AVISO_GERAL =
  "Esta configuração foi mudada em outro aparelho. Atualizamos a tela — confira e faça a mudança de novo.";

/** É a recusa da 20261643000000 (o `error` do supabase-js ou o que foi lançado). */
export function ehListaQueMudou(erro: unknown): boolean {
  return (
    !!erro &&
    typeof erro === "object" &&
    (erro as { code?: unknown }).code === CODIGO_LISTA_MUDOU
  );
}

/** A frase da tela para a recusa, pela coluna que veio no DETAIL. */
export function avisoDaListaQueMudou(erro: unknown): string {
  const detalhe =
    erro && typeof erro === "object"
      ? (erro as { details?: unknown }).details
      : undefined;
  switch (detalhe) {
    case "home_sections":
      return AVISO_DAS_VITRINES;
    case "formas_pagamento_entrega":
      return AVISO_DAS_FORMAS;
    case "metodos_locais":
    case "metodos_nacionais":
    case "categorias_sem_troca":
      return AVISO_DA_POLITICA_MUDOU;
    default:
      return AVISO_GERAL;
  }
}

/**
 * Reaplica a escolha da lojista por cima da lista que o servidor acabou de
 * devolver (merge de três vias, o mesmo das transportadoras no PR #2027): o
 * que ela ACRESCENTOU (escolhido e não visto) entra, o que ela TIROU (visto e
 * não escolhido) sai, o resto segue o servidor. A ordem é a do servidor, com
 * o acrescentado no fim na ordem em que ela escolheu; `ordem` (quando a lista
 * tem ordem canônica) reordena o resultado por ela.
 *
 * `mesmo` decide quando dois itens são o mesmo (padrão: igualdade exata).
 */
export function reaplicarEscolha<T>(
  vistos: readonly T[],
  escolhidos: readonly T[],
  doServidor: readonly T[],
  opcoes: {
    readonly mesmo?: (a: T, b: T) => boolean;
    readonly ordem?: readonly T[];
  } = {},
): T[] {
  const mesmo = opcoes.mesmo ?? ((a: T, b: T) => a === b);
  const tem = (lista: readonly T[], item: T) =>
    lista.some((outro) => mesmo(outro, item));
  const tirados = vistos.filter((v) => !tem(escolhidos, v));
  const acrescentados = escolhidos.filter((e) => !tem(vistos, e));
  const resultado: T[] = [];
  for (const item of [...doServidor, ...acrescentados]) {
    if (tem(tirados, item) || tem(resultado, item)) continue;
    resultado.push(item);
  }
  const { ordem } = opcoes;
  if (!ordem) return resultado;
  return ordem.filter((item) => tem(resultado, item));
}
