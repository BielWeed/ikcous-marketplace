import type { Product, ProductVariant } from "@/types";

/**
 * O preço que a VITRINE (card, faixa de Ofertas, Favoritos, ordenação por
 * preço) pode anunciar para um produto -- UI-191, G3.
 *
 * Antes cada tela lia `product.price` e `product.originalPrice` direto. Com
 * variação isso anunciava um preço que nenhuma opção à venda tinha: produto a
 * 50 com "De" 70, tamanho P (sem preço próprio) esgotado e tamanho G a 90 com
 * estoque aparecia como "De 70 · Por 50 · 29% OFF", entrava em Ofertas com
 * "Economize R$ 20" e, ao escolher G, o preço virava 90, acima do "De".
 *
 * A regra: o preço de vitrine é o MENOR preço entre as opções ATIVAS COM
 * ESTOQUE. Riscado, "% OFF" e economia só existem quando esse preço é menor
 * que o "De". Só exibição: o preço COBRADO continua sendo o do servidor, por
 * variação (`precoDaEscolha`); nada aqui entra no carrinho nem no pedido.
 */
export interface PrecoDeVitrine {
  /** O menor preço entre as opções à venda. */
  preco: number;
  /** As opções à venda custam coisas diferentes: a vitrine diz "a partir de". */
  aPartirDe: boolean;
  /** O "De" riscado; `null` quando `preco` não é menor que ele. */
  precoOriginal: number | null;
  /** Percentual inteiro de desconto (0 = sem desconto real). */
  desconto: number;
  /** Quanto se economiza, em reais (0 = sem desconto real). */
  economia: number;
}

type ProdutoDeVitrine = Pick<Product, "price" | "originalPrice" | "variants">;

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Os preços possíveis de UMA compra, pela mesma regra que o servidor cobra:
 * o preço é o da variação PRINCIPAL da escolha -- a do grupo de nome menor
 * (`ordenarPelaGrade`), que no cadastro antigo com Cor e Tamanho é a Cor -- e
 * o estoque é o de TODAS as escolhidas (levar "Azul P" precisa de azul E de P).
 */
function precosPossiveis(
  produto: ProdutoDeVitrine,
  apenasComEstoque: boolean,
): number[] {
  const ativas: ProductVariant[] = (produto.variants ?? []).filter(
    (variante) => variante.active,
  );
  if (ativas.length === 0) return [produto.price];

  const grupos = new Map<string, ProductVariant[]>();
  for (const variante of ativas) {
    const grupo = grupos.get(variante.name);
    if (grupo) grupo.push(variante);
    else grupos.set(variante.name, [variante]);
  }
  const temEstoque = (variante: ProductVariant) =>
    (variante.stockIncrement ?? 0) > 0;
  if (
    apenasComEstoque &&
    Array.from(grupos.values()).some((grupo) => !grupo.some(temEstoque))
  ) {
    return [];
  }

  const nomePrincipal = Array.from(grupos.keys()).sort(comparar)[0];
  const principais = grupos.get(nomePrincipal) ?? [];
  return principais
    .filter((variante) => !apenasComEstoque || temEstoque(variante))
    .map((variante) => variante.priceOverride ?? produto.price);
}

export function precoDeVitrine(produto: ProdutoDeVitrine): PrecoDeVitrine {
  const aVenda = precosPossiveis(produto, true);
  // Nada à venda (tudo sem estoque): o card ainda precisa de um preço, o menor
  // entre as opções ativas -- mostra "Esgotado" por cima.
  const precos = aVenda.length > 0 ? aVenda : precosPossiveis(produto, false);
  const preco = Math.min(...precos);
  const aPartirDe = new Set(precos).size > 1;

  const original = produto.originalPrice;
  const comDesconto = original != null && original > preco;
  return {
    preco,
    aPartirDe,
    precoOriginal: comDesconto ? original : null,
    desconto: comDesconto
      ? Math.round(((original - preco) / original) * 100)
      : 0,
    economia: comDesconto ? original - preco : 0,
  };
}
