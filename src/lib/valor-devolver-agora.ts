/**
 * L3e' rodada 2 (G3): o MESMO termo literal no texto do balde e no aviso de
 * cada pedido — o lojista leigo procura a frase exata que leu em cima.
 * B2b: o guia do pagamento que não fechou (GuiaDoPagamentoQueNaoFechou) cita
 * o mesmo termo, por isso ele mora aqui e não na view.
 */
export const TERMO_EM_ANDAMENTO = "Devolução em andamento";

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

// Dinheiro em CENTAVOS inteiros antes de somar/subtrair.
const centavos = (valor: number | null | undefined) =>
  Math.round((valor || 0) * 100);

/**
 * L3e' rodada 2 (revisão financeira, 02/10/2026): devolução que o Mercado
 * Pago JÁ concluiu, mas que o pedido desta lista ainda não mostra —
 * `valorEstornado` vem do retrato da lista e só muda quando ela recarrega
 * (realtime). `concluir_estorno` (2026110000100) é o único caminho que soma
 * em `valor_estornado`, e soma cada linha concluída uma vez só; então
 * `Σconcluido − valorEstornado` é exatamente o que concluiu depois do retrato.
 */
export function devolvidoPeloMercadoPagoForaDaLista(
  pedido: Parameters<typeof valorDevolverAgora>[0],
  concluido: number,
): number {
  return (
    Math.max(centavos(concluido) - centavos(pedido.valorEstornado), 0) / 100
  );
}

/**
 * L3e' (lacunas de pagamento, 02/10/2026): o que o LOJISTA ainda precisa
 * devolver, descontado também o que o Mercado Pago já está devolvendo
 * (`emCurso`: linhas `solicitado`/`em_processamento`) e o que ele concluiu
 * depois do retrato da lista (`concluido`, ver a função acima) — as duas
 * lidas de `order_refunds` por `useEstornosEmCursoDosPedidos`. Sem estes
 * descontos, "Devolver agora" pedia o total enquanto o app já devolvia — e
 * quem devolvia por fora pagava duas vezes.
 *
 * Função SEPARADA de `valorDevolverAgora` de propósito: aquela decide se o
 * pedido fica no balde (`baldeDeEstorno`), e o pedido com estorno em curso
 * PRECISA continuar na lista — é ali que o lojista vê "Devolução em
 * andamento" e que mora o "Já estornei" de quem já devolveu por fora.
 */
export function valorDevolverAgoraDescontandoLedger(
  pedido: Parameters<typeof valorDevolverAgora>[0],
  ledger: { readonly emCurso: number; readonly concluido: number },
): number {
  const resto =
    centavos(valorDevolverAgora(pedido)) -
    centavos(ledger.emCurso) -
    centavos(devolvidoPeloMercadoPagoForaDaLista(pedido, ledger.concluido));
  return Math.max(resto, 0) / 100;
}
