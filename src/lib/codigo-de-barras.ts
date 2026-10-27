/** Mesma string que vai para o banco (btrim + igualdade exata): aparar as
 * pontas e remover os espaços do meio (código colado ou digitado com
 * separador visual, como vem impresso na etiqueta EAN-13). O cadastro do
 * produto e o Balcão usam esta MESMA regra — duas cópias divergiriam. */
export function normalizarCodigoBarras(valor: string): string {
  return valor.trim().replace(/\s+/g, "");
}
