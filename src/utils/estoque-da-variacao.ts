/**
 * Estoque de variação é número inteiro, zero ou mais. O que não for isso
 * avisa e não grava: antes o sinal de menos e a vírgula eram arrancados em
 * silêncio ("-5" virava 5 e "2,5" virava 25). Vale para o formulário comum de
 * variação e para a grade de combinações (linhas e "Aplicar para todas").
 * Campo vazio vale 0 ao criar; ao editar uma variação existente, pede um número.
 */
export function erroDoEstoqueDaVariacao(
  texto: string,
  variacaoExistente = false,
): string | null {
  const limpo = texto.trim();
  if (variacaoExistente && limpo === "") {
    return "Informe o estoque da variação: digite 0 ou mais.";
  }
  if (limpo.startsWith("-")) {
    return "O estoque da variação não pode ser negativo. Digite 0 ou mais.";
  }
  if (limpo !== "" && !/^\d+$/.test(limpo)) {
    return "Digite o estoque da variação só com números inteiros (sem vírgula nem ponto).";
  }
  return null;
}
