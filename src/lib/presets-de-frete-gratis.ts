/**
 * Presets de frete grátis — a escolha ÚNICA do lojista na tela de Frete
 * (frente frete-v2-0309, ordem do dono 03/09/2026: "várias estratégias que
 * lojistas usam, o lojista seleciona o preset e edita do jeito que quer").
 *
 * Fonte única da regra (lição #53): a tela admin ESCREVE via `valorDoPreset`;
 * carrinho e checkout LEEM via `presetDoConfig`. Regra de negócio escrita em
 * dois lugares diverge — quem precisar da estratégia, importa daqui.
 *
 * `freeShippingMin` segue sendo o único campo persistido (sem migration):
 *  - `0`                     → `desligado` (semântica já viva no app inteiro)
 *  - `FRETE_GRATIS_SEMPRE`   → `sempre` (sentinela 0,01: todo pedido real é
 *    >= 0,01; `0` não pode porque significa "desligado" desde sempre)
 *  - `FRETE_GRATIS_POR_PRODUTO` → `por_produto` (sentinela -1: valor negativo
 *    não existe como limiar legítimo, então sobrou livre para a estratégia
 *    que não tem número — a marcação `product.freeShipping` dos produtos)
 *  - qualquer valor > 0      → `acima_de_valor`
 *
 * O preset `por_produto` mora na marcação `product.freeShipping`, que passa a
 * valer SÓ dentro dele. Antes a marcação valia incondicionalmente
 * (CartContext zerava o frete com qualquer item marcado) — modelo exclusivo
 * de presets escolhido com o dono: loja com produtos marcados precisa
 * selecionar o preset "Por produto marcado". Quem persiste o config no
 * SERVIDOR (RPC do pedido) tem que portar a MESMA regra — regra escrita em
 * dois lugares diverge (lição #53); a emenda da RPC acompanha esta frente.
 */
export type PresetFreteGratis =
  | "desligado"
  | "acima_de_valor"
  | "sempre"
  | "por_produto";

/** Sentinela de `freeShippingMin` para o preset "sempre grátis". */
export const FRETE_GRATIS_SEMPRE = 0.01;

/** Sentinela de `freeShippingMin` para o preset "por produto marcado". */
export const FRETE_GRATIS_POR_PRODUTO = -1;

export function presetDoConfig(freeShippingMin: number): PresetFreteGratis {
  if (freeShippingMin === FRETE_GRATIS_SEMPRE) return "sempre";
  if (freeShippingMin < 0) return "por_produto";
  if (freeShippingMin > 0) return "acima_de_valor";
  return "desligado";
}

/** Valor que a tela grava no config quando o lojista escolhe/salva um preset. */
export function valorDoPreset(
  preset: PresetFreteGratis,
  acimaDe: number,
): number {
  if (preset === "sempre") return FRETE_GRATIS_SEMPRE;
  if (preset === "por_produto") return FRETE_GRATIS_POR_PRODUTO;
  if (preset === "acima_de_valor") return Math.max(0, acimaDe);
  return 0;
}
