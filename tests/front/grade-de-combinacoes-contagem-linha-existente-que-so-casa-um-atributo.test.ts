// A conta ao vivo do passo 1 da grade ("N combinações novas") desconta só as
// linhas que JÁ EXISTEM no produto e caem DENTRO da grade. Uma linha que casa
// com um atributo mas sai da grade no outro ("Azul / G" quando a grade só tem
// P e M) não é nenhuma das combinações pedidas: descontá-la fazia o resumo
// prometer menos combinações do que o botão realmente cria (3 em vez de 4) —
// a lojista via o número errado antes de confirmar. Os testes de contagem que
// já existiam só usavam linhas inteiras dentro da grade, então trocar "todos os
// atributos casam" por "algum casa" passava despercebido.
import { describe, expect, it } from "vitest";

import {
  contarCombinacoesDaGrade,
  gerarGrade,
} from "@/utils/grade-de-combinacoes";

const grade = [
  { name: "Cor", valores: ["Azul", "Verde"] },
  { name: "Tamanho", valores: ["P", "M"] },
];

const linha = (value: string) => ({ name: "Cor / Tamanho", value });

describe("contagem de combinações novas da grade", () => {
  it("sem nada no produto, são todas as combinações (2 × 2 = 4)", () => {
    expect(contarCombinacoesDaGrade(grade, [])).toEqual({
      porAtributo: [2, 2],
      novas: 4,
    });
  });

  it("linha que já é uma das combinações da grade desconta uma", () => {
    expect(contarCombinacoesDaGrade(grade, [linha("Azul / P")]).novas).toBe(3);
  });

  it("linha que casa só a cor (o tamanho G está fora da grade) NÃO desconta", () => {
    expect(contarCombinacoesDaGrade(grade, [linha("Azul / G")]).novas).toBe(4);
  });

  it("linha que casa só o tamanho (a cor Branca está fora da grade) NÃO desconta", () => {
    expect(contarCombinacoesDaGrade(grade, [linha("Branca / P")]).novas).toBe(
      4,
    );
  });

  it("a contagem do resumo é a mesma de quantas linhas a grade cria de fato", () => {
    const existentes = [
      linha("Azul / G"),
      linha("Branca / P"),
      linha("Verde / M"),
    ];

    const contagem = contarCombinacoesDaGrade(grade, existentes).novas;
    const criadas = gerarGrade(grade, existentes).linhas.length;

    expect(criadas).toBe(3);
    expect(contagem).toBe(criadas);
  });
});
