/** Devolve 0 (positivo) quando `valor` arredonda para zero com `casas` casas
 * decimais; senão devolve `valor` como veio. É o que impede "-0%" na tela. */
export function semMenosZero(valor: number, casas: number): number {
  return Math.round(Math.abs(valor) * 10 ** casas) === 0 ? 0 : valor;
}

/** Percentual com 1 casa, em pt-BR ("130,2%", nunca "130.15%"): a mesma
 * grafia no cartão do topo, no simulador e no cartão detalhado dos produtos e
 * no formulário do produto. */
export function percentualComUmaCasa(valor: number): string {
  return `${semMenosZero(valor, 1).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}
