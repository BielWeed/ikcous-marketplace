/** Aviso de estoque baixo da vitrine, com concordância: "Resta apenas 1!"
 *  no singular e "Restam apenas N!" no plural. */
export function textoEstoqueBaixo(quantidade: number): string {
  return quantidade === 1 ? "Resta apenas 1!" : `Restam apenas ${quantidade}!`;
}

/** Aviso curto de quantidade restante, com concordância: "Só resta 1" no
 *  singular e "Só restam N" no plural (toasts e avisos do carrinho). */
export function textoSoRestam(quantidade: number): string {
  return quantidade === 1 ? "Só resta 1" : `Só restam ${quantidade}`;
}
