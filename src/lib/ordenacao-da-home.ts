import type { SortOption } from "@/types";

/**
 * As ordenações que a vitrine oferece à cliente.
 *
 * "Mais Vendidos" saiu em 14/10/2026: a coluna `sold` dos produtos nunca é
 * atualizada por nenhum fluxo de pedido ou pagamento (vale 0 em toda loja),
 * então a opção ordenava tudo empatado em zero e dizia à cliente que a lista
 * era dos mais vendidos sem ser. O selo MANUAL `isBestseller` (a lojista marca
 * à mão) e a vitrine "Destaques" continuam como estão.
 */
export const ORDENACOES_DA_HOME: readonly SortOption[] = [
  "default",
  "price-asc",
  "price-desc",
];

/**
 * Qualquer valor que não seja uma ordenação de hoje cai em "default"
 * (Relevância). Cobre quem ainda carrega o valor antigo `"sold"` — a vitrine
 * continua mostrando os produtos, na ordem padrão, nunca uma lista vazia.
 */
export function ordenacaoValida(valor: unknown): SortOption {
  return ORDENACOES_DA_HOME.find((ordem) => ordem === valor) ?? "default";
}
