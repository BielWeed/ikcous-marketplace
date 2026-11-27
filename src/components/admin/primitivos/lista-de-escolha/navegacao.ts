import { normalizeText } from "@/lib/utils";
import type { OpcaoDaLista } from "./tipos";

/** Índices sempre da lista VISÍVEL (já filtrada); -1 = nenhuma ativa. */

export function primeiraHabilitada(opcoes: readonly OpcaoDaLista[]): number {
  return opcoes.findIndex((o) => !o.desabilitada);
}

export function ultimaHabilitada(opcoes: readonly OpcaoDaLista[]): number {
  // `findLastIndex` é ES2023; o `lib` do app é ES2022.
  for (let i = opcoes.length - 1; i >= 0; i--) {
    if (!opcoes.at(i)?.desabilitada) return i;
  }
  return -1;
}

/**
 * ↓ (`1`) ou ↑ (`-1`) a partir de `atual`, pulando as desabilitadas. NÃO dá a
 * volta: na ponta, fica onde está (o padrão do `<select>` nativo). Sem ativa,
 * ↓ vai para a primeira e ↑ para a última.
 */
export function proximaHabilitada(
  opcoes: readonly OpcaoDaLista[],
  atual: number,
  direcao: 1 | -1,
): number {
  if (atual < 0) {
    return direcao === 1
      ? primeiraHabilitada(opcoes)
      : ultimaHabilitada(opcoes);
  }
  for (let i = atual + direcao; i >= 0 && i < opcoes.length; i += direcao) {
    if (!opcoes.at(i)?.desabilitada) return i;
  }
  return atual;
}

/**
 * Letra digitada sem busca: a próxima habilitada DEPOIS de `atual` cujo rótulo
 * começa com ela (sem acento nem caixa), dando a volta — apertar "c" de novo
 * passa por todas as que começam com "c". Nenhuma: fica onde está.
 */
export function porLetra(
  opcoes: readonly OpcaoDaLista[],
  letra: string,
  atual: number,
): number {
  const chave = normalizeText(letra);
  if (!chave || opcoes.length === 0) return atual;
  for (let passo = 1; passo <= opcoes.length; passo++) {
    const i = (Math.max(atual, -1) + passo + opcoes.length) % opcoes.length;
    const opcao = opcoes.at(i);
    if (
      opcao &&
      !opcao.desabilitada &&
      normalizeText(opcao.rotulo).startsWith(chave)
    ) {
      return i;
    }
  }
  return atual;
}
