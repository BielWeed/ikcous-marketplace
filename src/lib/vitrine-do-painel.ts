import { precoDeVitrine } from "@/lib/preco-de-vitrine";
import { ordenarParaVitrine } from "@/lib/vitrine";
import type { Product } from "@/types";

/**
 * As regras de "o que a loja mostra" nas faixas automáticas: a HomeView
 * (offerProducts, bestsellerProducts) e o painel de Destaques chamam estas
 * MESMAS funções. Produto pausado nunca aparece; esgotado
 * vai para o fim; "oferta" é o preço de vitrine abaixo do "De". A ordem dentro
 * da faixa é a de `ordenarParaVitrine` (mais novo primeiro, id no empate) e
 * NÃO a ordem de chegada da lista, que muda com o cache e a sincronização.
 */
type ParaVitrine = Pick<
  Product,
  "id" | "isActive" | "stock" | "price" | "originalPrice" | "variants"
> &
  Pick<Partial<Product>, "createdTime">;

export function produtosAVenda<T extends Pick<Product, "isActive">>(
  produtos: readonly T[],
): T[] {
  return produtos.filter((p) => p.isActive);
}

/** Ofertas: recebe os produtos À VENDA (ver `produtosAVenda`). */
export function ofertasDaVitrine<T extends ParaVitrine>(
  aVenda: readonly T[],
): T[] {
  return ordenarParaVitrine(
    aVenda.filter((p) => precoDeVitrine(p).precoOriginal !== null),
  );
}

/** Destaques em Alta: recebe os produtos À VENDA (ver `produtosAVenda`). */
export function destaquesDaVitrine<
  T extends Pick<Product, "id" | "isBestseller" | "stock" | "variants"> &
    Pick<Partial<Product>, "createdTime">,
>(aVenda: readonly T[]): T[] {
  return ordenarParaVitrine(aVenda.filter((p) => p.isBestseller));
}
