/** Aviso de estoque baixo da vitrine, com concordância: "Resta apenas 1!"
 *  no singular e "Restam apenas N!" no plural. */
export function textoEstoqueBaixo(quantidade: number): string {
  return quantidade === 1 ? "Resta apenas 1!" : `Restam apenas ${quantidade}!`;
}
