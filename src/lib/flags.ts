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

/**
 * Escala etapa 3 (11/09/2026): o valor deixou de ser assado no build
 * (`VITE_PAGAMENTO_ONLINE`, uma constante de módulo calculada uma vez para
 * TODAS as lojas) e passou a viajar na ficha da loja, lida a cada chamada.
 * Reexportado daqui — em vez de os consumidores importarem
 * `@/config/configuracaoDaLoja` diretamente — para que UMA porta só sirva
 * todo mundo: `CheckoutView`, `AdminDashboardView` e `AdminSettingsView`
 * importam `pagamentoOnlineLigado` só daqui. Motivo (ADENDO B.6): os 5
 * testes do checkout controlam a flag com `vi.mock("@/lib/flags", …)`, e um
 * consumidor que importasse por outra porta escaparia do mock em silêncio.
 */
export { pagamentoOnlineLigado } from "@/config/configuracaoDaLoja";
