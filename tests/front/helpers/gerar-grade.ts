// O botão do passo 1 da grade diz "Gerar grade" enquanto nada foi escolhido e
// "Gerar N combinações" / "Gerar N opções" depois (a mesma conta do resumo).
// Os testes que só querem APERTAR esse botão usam este padrão, em vez de
// repetir a conta de cada caso — o rótulo em si é provado em
// modal-variante-grade-passo1-claro.test.tsx.
export const BOTAO_GERAR_GRADE = /^Gerar (grade|\d+ (combinaç|opç))/;

/** Texto exato (contém) ou padrão; o botão é comparado sem as pontas. */
export function casaOTexto(
  textoDoBotao: string | null | undefined,
  alvo: string | RegExp,
): boolean {
  const texto = (textoDoBotao ?? "").trim();
  return typeof alvo === "string" ? texto.includes(alvo) : alvo.test(texto);
}
