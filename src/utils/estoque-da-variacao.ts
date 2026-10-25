/**
 * Estoque de variação é número inteiro, zero ou mais. O que não for isso
 * avisa e não grava: antes o sinal de menos e a vírgula eram arrancados em
 * silêncio ("-5" virava 5 e "2,5" virava 25). Vale para o formulário comum de
 * variação e para a grade de combinações (linhas e "Aplicar para todas").
 * Campo vazio não é erro: quem chama decide (fica como está ou vira 0).
 */
export function erroDoEstoqueDaVariacao(texto: string): string | null {
  const limpo = texto.trim();
  if (limpo.startsWith("-")) {
    return "O estoque da variação não pode ser negativo. Digite 0 ou mais.";
  }
  if (limpo !== "" && !/^\d+$/.test(limpo)) {
    return "Digite o estoque da variação só com números inteiros (sem vírgula nem ponto).";
  }
  return null;
}
