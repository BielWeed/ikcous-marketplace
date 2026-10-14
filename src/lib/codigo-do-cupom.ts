/**
 * Código do cupom como o painel grava: maiúsculas, sem espaço e SEM ACENTO.
 *
 * O servidor compara o código sem ignorar acento. Se o painel gravasse
 * "VERÃO10", a cliente que digita "VERAO10" recebia "Cupom inválido ou
 * expirado". Mesma técnica de `normalizeText` (NFD + tirar os sinais).
 */
export function normalizarCodigoDoCupom(
  valor: string | null | undefined,
): string {
  return (valor || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "");
}
