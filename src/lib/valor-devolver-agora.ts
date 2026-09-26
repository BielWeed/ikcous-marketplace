/**
 * Achado 1 da revisão de risco de 26/09/2026 (rodada 2, sobre as migrations
 * de devolução/financeiro que corrigiram a rodada 1).
 *
 * O balde "Devolver agora" (AdminOrdersView.baldeDeEstorno, AlertasCancelados)
 * mostrava e cobrava o TOTAL do pedido, mesmo quando uma devolução deste
 * mesmo pedido já tinha concluído com reembolso MANUAL (dinheiro que já saiu
 * por aquele caminho). Sem o desconto: "venda de balcão 100, devolução
 * concluída (100 manual), pedido cancelado" continuava pedindo R$100 de novo
 * em "Já estornei" — clicar registrava uma SEGUNDA saída do mesmo dinheiro.
 *
 * `pedido.valorDevolvidoPorDevolucao` vem de `get_admin_orders_cancelados_
 * recentes` (redefinida em 20261175000000): soma de `devolucoes.valor_
 * reembolso` das devoluções CONCLUÍDAS com `reembolso_manual = true` deste
 * pedido. Ausente (cache antigo, outro carregador) vale 0 — nada devolvido.
 *
 * Achado A4 da revisão de 26/09/2026 (rodada 3): `pedido.valorEstornado`
 * (coluna `marketplace_orders.valor_estornado`, somada só em
 * `concluir_estorno` quando o Mercado Pago aprova) é o MESMO tipo de
 * dinheiro-que-já-saiu, só que pelo ledger confirmado em vez da devolução
 * manual — sem descontar os dois, um estorno parcial já pago pelo MP
 * continuava pedindo o total cheio em "Já devolvi".
 *
 * Função isolada num arquivo próprio (em vez de morar só em
 * AdminOrdersView.tsx) porque AlertasCancelados.tsx também precisa dela para
 * EXIBIR o valor certo, e AdminOrdersView já importa AlertasCancelados — um
 * import de volta criaria um ciclo entre os dois módulos.
 */
export function valorDevolverAgora(pedido: {
  readonly total?: number | null;
  readonly valorDevolvidoPorDevolucao?: number | null;
  readonly valorEstornado?: number | null;
}): number {
  const total = pedido.total || 0;
  const jaDevolvido = pedido.valorDevolvidoPorDevolucao || 0;
  const jaEstornado = pedido.valorEstornado || 0;
  return Math.max(total - jaDevolvido - jaEstornado, 0);
}
