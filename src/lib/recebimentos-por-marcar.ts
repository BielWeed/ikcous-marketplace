/**
 * "Recebimento por marcar" — pedido ENTREGUE, pago na entrega ou na retirada
 * (não pelo site), em que a lojista ainda não marcou o recebimento. É o pedido
 * que ela respondeu "Ainda não" para "Recebeu o pagamento?" (ou nunca
 * respondeu): o `payment_status` fica em branco, e enquanto isso o servidor
 * RECUSA o pedido de devolução ou troca da cliente ("Este pedido não tem
 * pagamento a devolver", `devolucao_elegibilidade` / `solicitar_devolucao`).
 * Marcar o recebimento é o ato que destrava a cliente — por isso o aviso conta
 * no sino.
 *
 * UMA regra só, lida pela lista de Notificações (`useAvisosDoLojista`) e pela
 * bolinha do sino (`AdminLayout`): duas contagens diferentes para a mesma
 * pergunta seria pior que nenhuma.
 *
 * "Pago pelo site" é `payment_method = 'online'` — a MESMA definição de
 * `podeRegistrarPagamento` (`paymentMethod !== "online"`), de
 * `OrderDetail.tsx` (a pergunta "Recebeu o pagamento?") e da RPC
 * `registrar_pagamento_recebido`. `payment_method` nulo conta como NA ENTREGA:
 * o mapper (`mappers.ts`) lê nulo como `"cash"`.
 */

/**
 * Só o que entregou nos últimos 30 dias entra: sem janela, todo pedido antigo
 * nunca marcado ficaria na lista para sempre e o sino nunca zeraria.
 *
 * A data é `updated_at` (a coluna que a tela já lê), e é só uma APROXIMAÇÃO
 * da data da entrega, com duas ressalvas honestas:
 *   - O servidor (`devolucao__entregue_em`) usa a linha `new_status =
 *     'delivered'` de `marketplace_order_history`. `updated_at` anda com
 *     qualquer edição do pedido (marcar o recebimento, desfazer, cancelar) e
 *     um update em massa futuro renovaria a data de todos de uma vez, trazendo
 *     de volta para a lista pedido entregue há muito tempo. O pedido com o
 *     recebimento marcado não tem mais pagamento em branco e sai da lista;
 *     desfazer a marcação o devolve à lista, com a data renovada.
 *   - A janela (30 dias) é MENOR que o prazo de vício padrão da política de
 *     devolução (90 dias, `politica_devolucao.prazo_vicio_dias`): uma cliente
 *     ainda dentro do prazo de devolução pode ter o pedido fora do aviso. É
 *     escolha de produto para a lista não crescer sem fim, não cobertura do
 *     prazo da cliente.
 */
export const JANELA_DE_RECEBIMENTO_DIAS = 30;

/** Teto da lista do sino: a tela é "o que falta fazer", não um relatório. */
export const TETO_DE_RECEBIMENTOS = 100;

/** O `.or(...)` do PostgREST de "não é pago pelo site" (`null` ou diferente de online). */
export const FILTRO_POSTGREST_PAGAMENTO_NA_ENTREGA =
  "payment_method.is.null,payment_method.neq.online";

/** O ISO do começo da janela, a partir de `agora` (injetável para o teste). */
export function inicioDaJanelaDeRecebimento(
  agora: number = Date.now(),
): string {
  return new Date(
    agora - JANELA_DE_RECEBIMENTO_DIAS * 24 * 3600 * 1000,
  ).toISOString();
}
