/**
 * Teto de unidades de UM item no carrinho, mesmo com estoque maior (trava contra
 * pedido inflado). Fica fora do CartContext para o seletor de quantidade e o
 * carrinho lerem o MESMO número: antes o seletor deixava pedir o estoque inteiro
 * e o carrinho cortava em silêncio.
 */
export const MAX_ITEM_QUANTITY = 500;

/** Frase do corte pelo teto (toast do carrinho). */
export const AVISO_DO_TETO_POR_ITEM = `Máximo de ${MAX_ITEM_QUANTITY} unidades por item em cada pedido.`;

/** Dica do "+" quando travou no teto, com estoque de sobra. */
export const DICA_DO_TETO_POR_PEDIDO = `Máximo de ${MAX_ITEM_QUANTITY} por pedido`;
