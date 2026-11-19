import { ESTOQUE_MAXIMO_DA_VARIACAO } from "./truth_gate";

export const ESTOQUE_MAXIMO_DA_VARIACAO_EM_TEXTO =
  ESTOQUE_MAXIMO_DA_VARIACAO.toLocaleString("pt-BR");
export const MENSAGEM_ESTOQUE_MAXIMO_DA_VARIACAO = `O estoque máximo é ${ESTOQUE_MAXIMO_DA_VARIACAO_EM_TEXTO}`;

export function estoqueDaVariacaoValido(estoque: unknown): estoque is number {
  return (
    typeof estoque === "number" &&
    Number.isSafeInteger(estoque) &&
    estoque >= 0 &&
    estoque <= ESTOQUE_MAXIMO_DA_VARIACAO
  );
}

/**
 * Estoque de variação é número inteiro, de zero até o limite da gravação.
 * Antes o sinal de menos e a vírgula eram arrancados em
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
  // O limite está na faixa exata do JavaScript: um valor que arredonde
  // por ser grande demais continua acima dele e nunca chega à conta.
  if (Number(limpo) > ESTOQUE_MAXIMO_DA_VARIACAO) {
    return MENSAGEM_ESTOQUE_MAXIMO_DA_VARIACAO;
  }
  return null;
}
