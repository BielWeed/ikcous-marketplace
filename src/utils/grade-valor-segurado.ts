/**
 * O valor digitado em "Aplicar para todas" (grade de variações, passo 2) e NÃO
 * aplicado — a lojista não clicou no botão — fica SEGURADO e é preenchido nas
 * linhas na hora de efetivar. Antes ele era ignorado: o produto ficava sem
 * preço, o formulário pedia o Preço de Venda de novo e o estoque das linhas
 * gravava 0.
 *
 * Diferente do botão (que SOBRESCREVE todas as linhas), o segurado só preenche
 * o que a lojista ainda não decidiu:
 *  - preço: as linhas de preço VAZIO (o "Auto"). Um preço digitado na linha,
 *    inclusive 0,00 de brinde, nunca é sobrescrito;
 *  - estoque: as linhas cujo estoque ela NUNCA mexeu (`estoqueEditado`). Não
 *    se usa "é 0" como sinal de "intocado": um 0 digitado de propósito numa
 *    linha (mexeu e voltou a 0) tem que continuar 0.
 *
 * Função pura: devolve as linhas já preenchidas e o resultado entra na MESMA
 * conta de `resolverPrecoDaGrade` — o preço do produto e o estoque saem de uma
 * fonte só, as linhas efetivas.
 */
import { limparNumero, precoDaLinha } from "@/utils/preco-da-grade";

export interface LinhaComValores {
  estoque: string;
  preco: string;
  /** A lojista mexeu no estoque desta linha (digitou nela ou aplicou para todas). */
  estoqueEditado?: boolean;
}

/** O estoque segurado, na mesma limpeza do botão e da linha (só dígitos). */
const estoqueDoSegurado = (bruto: string): string => bruto.replace(/\D/g, "");

/** O preço segurado que vale: número maior que zero, na mesma limpeza do botão
 *  ("49,90" vira "49.90"). Texto inválido, vazio ou 0,00 não vale — nunca vira
 *  preço zero (cobrança de graça) nem NaN. */
const precoDoSegurado = (bruto: string): string => {
  const numero = precoDaLinha(bruto);
  return numero !== undefined && numero > 0 ? limparNumero(bruto) : "";
};

export function preencherComSegurado<T extends LinhaComValores>(
  linhas: T[],
  estoqueSegurado: string,
  precoSegurado: string,
): { linhas: T[]; preencheu: boolean } {
  const estoque = estoqueDoSegurado(estoqueSegurado);
  const preco = precoDoSegurado(precoSegurado);
  if (estoque === "" && preco === "") return { linhas, preencheu: false };

  let preencheu = false;
  const preenchidas = linhas.map((linha) => {
    const preencheEstoque =
      estoque !== "" && !linha.estoqueEditado && linha.estoque !== estoque;
    const preenchePreco =
      preco !== "" && precoDaLinha(linha.preco) === undefined;
    if (!preencheEstoque && !preenchePreco) return linha;
    preencheu = true;
    return {
      ...linha,
      estoque: preencheEstoque ? estoque : linha.estoque,
      preco: preenchePreco ? preco : linha.preco,
    };
  });
  return { linhas: preencheu ? preenchidas : linhas, preencheu };
}
