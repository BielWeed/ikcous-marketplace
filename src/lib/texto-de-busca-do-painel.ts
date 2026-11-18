/** Texto literal para estado da tela e comparações locais, sem escape SQL. */
export function normalizarTextoDeBuscaDoPainel(texto: string): string {
  return texto.trim().replace(/\s+/g, " ");
}

/** Só para RPCs que concatenam o termo em LIKE/ILIKE com escape padrão (\\).
 * Não usar na busca de produtos (já escapa no banco) nem em filtros PostgREST.
 */
export function prepararTextoDeBuscaDoPainel(texto: string): string {
  return normalizarTextoDeBuscaDoPainel(texto)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
