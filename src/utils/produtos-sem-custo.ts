// Quantos produtos vendidos ficaram FORA do lucro por não terem custo
// cadastrado. Vem de `productsWithoutCost` na RPC `get_admin_analytics_v2`
// (migration 20261234): a tela é publicada ANTES dela, então o campo pode
// não existir — ausente, nulo, texto, negativo, fracionado ou NaN valem 0
// (comportamento de hoje, sem aviso nenhum).
export function produtosSemCusto(stats: unknown): number {
  const valor = (stats as { productsWithoutCost?: unknown } | null | undefined)
    ?.productsWithoutCost;
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0
    ? valor
    : 0;
}

/**
 * O produto entra no selo "N produtos sem custo" da tela Produtos? É a regra
 * de `get_admin_analytics_v2` (migration 20261251000000), que a lista "Sem
 * custo" repete para o número do selo e a lista nunca divergirem: produto
 * ATIVO com custo ausente (NULL) e estoque efetivo maior que zero. Custo 0 é
 * custo zero de propósito (brinde) e fica de fora. O `stock` do produto
 * mapeado já é o estoque efetivo (soma das variações ativas, senão o do pai).
 * O "não apagado" fica por conta da consulta (`deleted_at IS NULL`).
 */
export function produtoSemCustoEmEstoque(produto: {
  readonly isActive: boolean;
  readonly costPrice?: number | null;
  readonly stock: number;
}): boolean {
  return produto.isActive && produto.costPrice == null && produto.stock > 0;
}

/** "1 produto sem custo cadastrado ficou fora do lucro." (plural certo). */
export function avisoProdutosSemCusto(quantidade: number): string {
  return quantidade === 1
    ? "1 produto sem custo cadastrado ficou fora do lucro."
    : `${quantidade} produtos sem custo cadastrado ficaram fora do lucro.`;
}
