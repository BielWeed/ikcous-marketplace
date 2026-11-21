/** Recebe só dígitos, já sem o código do país: DDD seguido do telefone. */
export function telefoneNacionalZerado(digitos: string): boolean {
  return /^0+$/.test(digitos.slice(2));
}
