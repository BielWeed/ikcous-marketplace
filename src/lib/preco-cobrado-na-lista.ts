import { precosPossiveis } from "./preco-de-vitrine";

/**
 * O preço que a lista de Produtos do painel mostra: o que a cliente PAGA, não
 * o `price` base do cadastro. Com tamanhos a preço próprio, a lista dizia
 * "R$ 69,90" (o base) enquanto a loja cobrava 89,90 em toda opção.
 *
 * Sem regra nova: os preços são os de `precosPossiveis` -- a mesma conta do
 * servidor (`COALESCE(price_override, preco_venda)`, só null segue o produto e
 * zero é preço), sobre as variações ATIVAS do grupo principal. A lista não olha
 * estoque: o esgotado continua mostrando quanto custa.
 *
 * Todas iguais → um preço; diferentes → "R$ menor – R$ maior". O "De" da
 * promoção (`originalPrice`) segue fora da lista, como antes. O número sai no
 * mesmo formato que a lista já usava (`toLocaleString`, ponto de milhar).
 */
export function precoCobradoNaLista(
  produto: Parameters<typeof precosPossiveis>[0],
): string {
  const precos = precosPossiveis(produto, false);
  const menor = Math.min(...precos);
  const maior = Math.max(...precos);
  return menor === maior
    ? emReais(menor)
    : `${emReais(menor)} – ${emReais(maior)}`;
}

function emReais(valor: number): string {
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}
