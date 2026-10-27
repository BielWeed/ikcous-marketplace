import { precoDeVitrine } from "@/lib/preco-de-vitrine";
import type { Product } from "@/types";

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
 *   1. com estoque vem antes de sem estoque (`stock > 0`; null/undefined
 *      conta como sem estoque);
 *   2. dentro de cada grupo, mais recente primeiro (`createdTime ?? 0`).
 */
export function ordenarParaVitrine<
  T extends { stock?: number | null; createdTime?: number },
>(produtos: readonly T[]): T[] {
  // `?? 0` é a regra: null/undefined (legado sem estoque gravado) conta como
  // sem estoque — o mesmo que `a.stock > 0` fazia na HomeView com número.
  const disponivel = (p: T) => ((p.stock ?? 0) > 0 ? 1 : 0);
  return [...produtos].sort((a, b) => {
    const aAvailable = disponivel(a);
    const bAvailable = disponivel(b);
    if (aAvailable !== bAvailable) {
      return bAvailable - aAvailable;
    }
    return (b.createdTime ?? 0) - (a.createdTime ?? 0);
  });
}

/**
 * As regras de "o que a loja mostra" nas faixas automáticas, para o painel de
 * Destaques usar as MESMAS (a HomeView as escreve igual: produtosAVenda,
 * offerProducts, bestsellerProducts). Produto pausado nunca aparece; esgotado
 * vai para o fim; "oferta" é o preço de vitrine abaixo do "De".
 */
type ParaVitrine = Pick<
  Product,
  "isActive" | "stock" | "price" | "originalPrice" | "variants"
>;

export function produtosAVenda<T extends Pick<Product, "isActive">>(
  produtos: readonly T[],
): T[] {
  return produtos.filter((p) => p.isActive);
}

const esgotadosPorUltimo = (a: { stock: number }, b: { stock: number }) =>
  (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0);

/** Ofertas: recebe os produtos À VENDA (ver `produtosAVenda`). */
export function ofertasDaVitrine<T extends ParaVitrine>(
  aVenda: readonly T[],
): T[] {
  return aVenda
    .filter((p) => precoDeVitrine(p).precoOriginal !== null)
    .sort(esgotadosPorUltimo);
}

/** Destaques em Alta: recebe os produtos À VENDA (ver `produtosAVenda`). */
export function destaquesDaVitrine<
  T extends Pick<Product, "isBestseller" | "stock">,
>(aVenda: readonly T[]): T[] {
  return aVenda.filter((p) => p.isBestseller).sort(esgotadosPorUltimo);
}
