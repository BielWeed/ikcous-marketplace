/** Mesma limpeza para códigos digitados no painel e recebidos do provedor. */
export function normalizarCodigoDeRastreio(codigo: string): string {
  return (codigo ?? "")
    .replace(/[\p{Z}\p{Cc}\p{Cf}\u{2800}]+/gu, "")
    .toUpperCase();
}

/** Pontuação pode fazer parte do código, mas não ser tudo. */
export function codigoDeRastreioTemLetraOuDigito(codigoLimpo: string): boolean {
  return /[\p{L}\p{Nd}]/u.test(codigoLimpo);
}
