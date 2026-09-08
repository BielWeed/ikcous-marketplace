// Duas telas decidiam sozinhas se a chave pública estava no build (diretor, #470+#473).
// Checar no backend é decisão do dono, fora deste ajuste.
export function pixConfiguradoNoBuild(
  chavePublica: string | undefined,
): boolean {
  return !!chavePublica && chavePublica !== "YOUR_MP_PUBLIC_KEY_HERE";
}
