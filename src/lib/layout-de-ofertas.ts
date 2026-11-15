/** Desenhos que a lojista pode escolher para cada vitrine da home. */
export type LayoutDeOfertas =
  | "padrao"
  | "compacto"
  | "lateral"
  | "lateral-duplo";

/** Config vinda do banco com valor ausente ou desconhecido cai no Padrão. */
export function normalizarLayoutDeOfertas(valor: unknown): LayoutDeOfertas {
  return valor === "compacto" ||
    valor === "lateral" ||
    valor === "lateral-duplo"
    ? valor
    : "padrao";
}

// Nomes neutros para as demais vitrines; os importadores antigos continuam válidos.
export type LayoutDeVitrine = LayoutDeOfertas;
export const normalizarLayoutDeVitrine = normalizarLayoutDeOfertas;
