/**
 * RETIRADA NA LOJA (release 1.5.3, 22/09/2026) — o contrato, num lugar só
 * das edge functions.
 *
 * `store-pickup` é, ao mesmo tempo:
 *   - o ID da opção de entrega que `calculate-shipping` oferece à cliente da
 *     área local (preço 0, com o endereço físico da loja);
 *   - a CHAVE que a loja põe em `store_config.enabled_shipping_methods` para
 *     ligar a retirada (ausente = desligada — nenhuma loja nasce com ela).
 *
 * O mesmo literal mora na RPC do pedido (migration 20261169000000, que
 * revalida os três requisitos e grava `customer_data.pickup_address`) e no
 * front (`src/lib/guarda-de-frete.ts`). As edge functions rodam em Deno com
 * import de URL e não alcançam o `src/` do app — por isso a cópia aqui, e
 * só aqui do lado da edge.
 */
export const ID_RETIRADA_NA_LOJA = "store-pickup";

/** O id é o contrato: comparação EXATA, sem trim nem caixa (fail-closed). */
export function ehRetiradaNaLoja(id: unknown): boolean {
  return id === ID_RETIRADA_NA_LOJA;
}
