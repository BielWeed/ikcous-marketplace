// Sem `import` DE PROPÓSITO: `preco-de-vitrine.ts` importa este módulo e roda
// também na borda (`src/hospedagem/precoDaPrevia.ts`), onde só entram módulos
// puros.
/**
 * O percentual do selo "% OFF": UMA conta para todas as telas.
 *
 * Em reais com vírgula flutuante duas fórmulas "iguais" divergem: De 40,00 por
 * 31,00 é 22,5%, e `(40 - 31) / 40 * 100` dá 22.5 (selo "23%") enquanto
 * `(1 - 31 / 40) * 100` dá 22.499999999999996 (selo "22%") -- a cliente abria as
 * opções e o desconto "diminuía". Aqui a conta é em centavos inteiros e o meio
 * por cento arredonda para cima (22,5 -> 23).
 *
 * Devolve um inteiro >= 0. Zero quer dizer "sem selo": sem preço original
 * válido, preço atual que não é menor que o original, entrada ausente ou não
 * finita, ou desconto abaixo de meio por cento (que arredonda para 0).
 */
export function percentualDeDesconto(
  precoOriginal: number | null | undefined,
  precoAtual: number | null | undefined,
): number {
  if (
    typeof precoOriginal !== "number" ||
    typeof precoAtual !== "number" ||
    !Number.isFinite(precoOriginal) ||
    !Number.isFinite(precoAtual)
  ) {
    return 0;
  }
  const originalEmCentavos = Math.round(precoOriginal * 100);
  const atualEmCentavos = Math.round(precoAtual * 100);
  if (originalEmCentavos <= 0 || atualEmCentavos >= originalEmCentavos) {
    return 0;
  }
  return Math.round(
    ((originalEmCentavos - atualEmCentavos) * 100) / originalEmCentavos,
  );
}
