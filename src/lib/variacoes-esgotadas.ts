import { rotuloDaVariacao } from "@/lib/rotulo-da-variacao";
import type { Product } from "@/types";

/** Só escolhas ativas: produto sem grade já tem o aviso de estoque existente. */
export function variacoesEsgotadas(produtos: readonly Product[] = []) {
  return produtos.flatMap((produto) => {
    if (!produto.isActive || produto.variantsUnavailable) return [];
    const ativas = produto.variants?.filter((v) => v.active) ?? [];
    if (ativas.length < 2) return [];
    return ativas
      .filter((v) => v.stockIncrement === 0)
      .map((v) => ({
        id: v.id,
        produtoId: produto.id,
        texto: `${produto.name} — ${rotuloDaVariacao(v.name, v.value)} esgotou`,
        detalhe: ativas.some((v) => v.stockIncrement > 0)
          ? "O produto ainda tem estoque nas outras variações."
          : "Todas as variações ativas estão esgotadas.",
      }));
  });
}
