/**
 * A ordenação da vitrine, em UM lugar.
 *
 * Item 15 do laudo "o que falta" (29/08, degrau 3): o preview do carrossel
 * no painel ordenava só por data, enquanto a loja põe os produtos SEM
 * estoque no fim ANTES de cortar — a lojista montava a vitrine vendo uma
 * ordem que a loja não mostrava (sem-estoque aparecia no preview e não na
 * loja). Preview e loja passam a chamar ESTA função, e a regra não pode mais
 * divergir entre os dois lugares (mesma lição do #53, frete grátis em sete
 * lugares).
 *
 * A regra (byte a byte a que a HomeView usava desde sempre):
 *   1. com estoque vem antes de sem estoque (`produtoDisponivel`: `stock > 0`,
 *      null/undefined conta como sem estoque; com opções, TODA opção — Cor,
 *      Tamanho... — precisa ter ao menos uma escolha com estoque);
 *   2. dentro de cada grupo, mais recente primeiro (`createdTime ?? 0`);
 *   3. empate de data: o id decide. Sem isto a ordem de chegada da lista
 *      (cache, Realtime) escolhia quem entra nas faixas de seis.
 */

/** O bastante de uma opção do produto para saber se ela tem o que vender. */
interface OpcaoParaDisponibilidade {
  name: string;
  active: boolean;
  stockIncrement?: number;
}

/**
 * O produto tem como ser comprado? A pergunta única da vitrine: o cartão, o
 * botão "Esgotado" e a ordenação respondem pela mesma regra.
 *
 * Sem opção ativa vale o estoque do produto. Com opções ativas (Cor e Tamanho
 * cadastrados em separado), levar o produto exige UMA escolha de CADA grupo:
 * se um grupo inteiro está zerado ninguém compra, mesmo que a soma `stock` do
 * produto seja positiva (a soma das cores sustentava um "Estoque: 8" falso).
 */
export function produtoDisponivel(produto: {
  stock?: number | null;
  variants?: readonly OpcaoParaDisponibilidade[] | null;
}): boolean {
  const ativas = (produto.variants ?? []).filter((v) => v.active);
  if (ativas.length === 0) return (produto.stock ?? 0) > 0;
  const grupos = new Map<string, boolean>();
  for (const opcao of ativas) {
    const temEstoque = (opcao.stockIncrement ?? 0) > 0;
    grupos.set(opcao.name, (grupos.get(opcao.name) ?? false) || temEstoque);
  }
  return Array.from(grupos.values()).every(Boolean);
}

export function ordenarParaVitrine<
  T extends {
    id?: string;
    stock?: number | null;
    createdTime?: number;
    variants?: readonly OpcaoParaDisponibilidade[] | null;
  },
>(produtos: readonly T[]): T[] {
  const disponivel = (p: T) => (produtoDisponivel(p) ? 1 : 0);
  return [...produtos].sort((a, b) => {
    const aAvailable = disponivel(a);
    const bAvailable = disponivel(b);
    if (aAvailable !== bAvailable) {
      return bAvailable - aAvailable;
    }
    const porData = (b.createdTime ?? 0) - (a.createdTime ?? 0);
    if (porData !== 0 || a.id === undefined || b.id === undefined) {
      return porData;
    }
    return a.id.localeCompare(b.id);
  });
}
