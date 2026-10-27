import { precoDeVitrine } from "@/lib/preco-de-vitrine";
import type { Product } from "@/types";

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
