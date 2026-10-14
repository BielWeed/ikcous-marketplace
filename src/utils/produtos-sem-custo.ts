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

/** "1 produto sem custo cadastrado ficou fora do lucro." (plural certo). */
export function avisoProdutosSemCusto(quantidade: number): string {
  return quantidade === 1
    ? "1 produto sem custo cadastrado ficou fora do lucro."
    : `${quantidade} produtos sem custo cadastrado ficaram fora do lucro.`;
}
