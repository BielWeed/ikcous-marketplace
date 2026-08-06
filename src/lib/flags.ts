/**
 * Flags de build do front.
 *
 * VITE_PAGAMENTO_ONLINE existe porque a Fase 2 entrega o caminho de cobrança
 * SEM a confirmação, que é a Fase 3. Se este caminho virar padrão antes do
 * webhook, todo pedido pago expira em 30 minutos e o pg_cron devolve o
 * estoque — pior que o problema que a Fase 1 consertou.
 *
 * Por isso ela falha fechada: só a string exata "true" liga.
 */
export function lerFlagPagamentoOnline(valor: string | undefined): boolean {
  return valor === "true";
}

export const PAGAMENTO_ONLINE_LIGADO = lerFlagPagamentoOnline(
  import.meta.env.VITE_PAGAMENTO_ONLINE,
);
