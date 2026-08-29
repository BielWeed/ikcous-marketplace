import type { Order } from "@/types";

/**
 * Task 4b do plano docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md
 * — extraída de `AdminOrdersView.tsx` (Task 4) para este módulo compartilhado.
 * `OrderDetail.tsx` passou a precisar dela (a ficha do pedido virou a dona
 * do recebimento, não só o cartão da lista), e `AdminOrdersView.tsx` já
 * importa `OrderDetail` — importar a função de volta de lá fecharia um
 * ciclo de importação. Este módulo não importa nenhum dos dois.
 *
 * Espelha as duas primeiras recusas da RPC `registrar_pagamento_recebido`
 * (migration `20261020000000`): pedido pago pelo site é confirmado pelo
 * gateway, nunca pela loja; pedido cancelado não recebe pagamento nem tem
 * o recebimento desfeito.
 *
 * Escrita UMA VEZ e usada por todo lugar que decide se mostra o botão
 * "Marcar como recebido"/"Desfazer" (cartão da lista e ficha do pedido) e
 * se a ficha pergunta "Recebeu o pagamento?" ao avançar para "delivered".
 * Se cada lugar checasse a condição por conta própria, um pedido marcado
 * como recebido e depois cancelado poderia mostrar "Desfazer" em um lugar
 * e não no outro, mesmo a RPC recusando o clique nos dois.
 */
export function podeRegistrarPagamento(pedido: Order): boolean {
  return pedido.paymentMethod !== "online" && pedido.status !== "cancelled";
}
