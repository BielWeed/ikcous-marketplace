/** Mesma string que vai para o banco (btrim + igualdade exata): aparar as
 * pontas e remover os espaços do meio (código colado ou digitado com
 * separador visual, como vem impresso na etiqueta EAN-13). O cadastro do
 * produto e o Balcão usam esta MESMA regra — duas cópias divergiriam. */
export function normalizarCodigoBarras(valor: string): string {
  return valor.trim().replace(/\s+/g, "");
}

/** O formato que o campo "Código de barras" do cadastro aceita (já normalizado). */
export const REGEX_CODIGO_BARRAS = /^[A-Za-z0-9-]{4,64}$/;
