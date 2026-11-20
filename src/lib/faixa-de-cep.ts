export const EXEMPLO_DE_INTERVALO_DE_CEP = "38500-000, 38599-999";

/**
 * Há algum CEP de 8 dígitos que a cotação aceitaria para a faixa escrita?
 * Espelha supabase/functions/calculate-shipping/index.ts:558–596 (isLocalCep).
 * O vazio não é uma faixa: a cotação usa a região da loja nesse caso.
 */
export function faixaDeCepReconhecida(faixa: string): boolean {
  return faixa.split(",").some((item) => {
    const partes = item
      .split("-")
      .map((parte) => parte.replace(/\D/g, ""))
      .filter(Boolean);

    if (partes.length === 2 && partes[0].length >= 6 && partes[1].length >= 6) {
      const inicio = Number(partes[0].padEnd(8, "0"));
      const fim = Number(partes[1].padEnd(8, "9"));
      // A cotação ordena as pontas. Basta que a menor caiba em 8 dígitos.
      return Math.min(inicio, fim) <= 99_999_999;
    }

    // Dois CEPs completos podem virar um intervalo; ambos já casam aqui.
    // Um item curto é prefixo; acima de 8 dígitos não casa com destino algum.
    return partes.length > 0 && partes.join("").length <= 8;
  });
}
