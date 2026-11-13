/**
 * O recado do aviso "devolução esperando sua resposta" para a tela
 * Devoluções: "esta abertura veio do aviso, abra em Solicitadas".
 *
 * Por que existe: o aviso conta só as devoluções `solicitada` (a resposta é da
 * loja e o prazo legal corre), mas a tela nasce em "Todas", mais recentes
 * primeiro. Com uma solicitação antiga e dezenas de concluídas mais novas, a
 * lojista tocava em "1" e a primeira página mostrava só concluídas.
 *
 * Mesmo desenho do recado do Início para Pedidos
 * (`atalho-do-inicio-para-pedidos.ts`): vale UMA vez e tem validade. A tela
 * fica montada atrás das outras abas e lê o recado quando passa a estar à
 * vista; um recado esquecido não pode, horas depois, trocar o chip de quem
 * abriu Devoluções pelo menu.
 */

/** Tempo máximo entre o toque no aviso e a tela Devoluções ficar à vista. */
const VALIDADE_DO_PEDIDO_MS = 30_000;

let pedidoEm: number | null = null;

/** O aviso chama ao tocar, antes de navegar para Devoluções. */
export function pedirDevolucoesSolicitadas(agora: number = Date.now()): void {
  pedidoEm = agora;
}

/**
 * Só espiar, sem gastar o recado: a tela que ainda vai abrir já nasce no
 * chip certo, em vez de pedir a lista toda e trocar logo depois. Não escreve
 * nada (pode ser lida no render); quem gasta o recado é o `consumir...`.
 */
export function haPedidoDeDevolucoesSolicitadas(
  agora: number = Date.now(),
): boolean {
  return pedidoEm !== null && agora - pedidoEm <= VALIDADE_DO_PEDIDO_MS;
}

/**
 * A tela Devoluções chama quando passa a estar à vista. Devolve `true` no
 * máximo UMA vez por pedido do aviso, e só se ele ainda estiver na validade.
 */
export function consumirPedidoDeDevolucoesSolicitadas(
  agora: number = Date.now(),
): boolean {
  const desde = pedidoEm;
  pedidoEm = null;
  return desde !== null && agora - desde <= VALIDADE_DO_PEDIDO_MS;
}
