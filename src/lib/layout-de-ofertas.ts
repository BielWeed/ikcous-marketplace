/** Desenhos da faixa "Ofertas" que a lojista pode escolher no painel. */
export type LayoutDeOfertas = "padrao" | "compacto" | "lateral";

/** Config vinda do banco com valor ausente ou desconhecido cai no Padrão. */
export function normalizarLayoutDeOfertas(valor: unknown): LayoutDeOfertas {
  return valor === "compacto" || valor === "lateral" ? valor : "padrao";
}
