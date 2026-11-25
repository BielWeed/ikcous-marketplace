// `src/utils/grade-de-combinacoes.ts`: duas bordas que os testes vizinhos
// deixavam passar (caça por mutação).
//
//  - `skusDaGrade`: vários espaços seguidos viram UM hífen só ("blu  vip" vira
//    "BLU-VIP", não "BLU--VIP"): o código que a lojista digita com espaço duplo
//    não pode sair com hífen duplo, nem na base nem no sufixo do valor;
//  - `contarCombinacoesDaGrade`: linha que já existe só desconta da conta se
//    TODOS os nomes de atributo casam com os da grade (e os valores estão nela).
//    Um nome igual e o outro diferente ("Cor / Material" × grade "Cor / Tamanho")
//    é outra combinação, mesmo com os valores iguais.
import {
  contarCombinacoesDaGrade,
  gerarGrade,
  skusDaGrade,
} from "@/utils/grade-de-combinacoes";
import { describe, expect, it } from "vitest";

describe("skusDaGrade — espaços seguidos viram um hífen só", () => {
  it("espaço duplo na base e no valor (o sufixo é cortado em 3 letras DEPOIS de colapsar)", () => {
    expect(skusDaGrade("blu  vip", [{ name: "Cor", value: "R  osa" }])).toEqual(
      ["BLU-VIP-R-O"],
    );
  });

  it("tabulação e espaços misturados também colapsam", () => {
    expect(
      skusDaGrade("blu \t  vip", [{ name: "Cor", value: "Azul" }]),
    ).toEqual(["BLU-VIP-AZU"]);
  });
});

describe("contarCombinacoesDaGrade — um nome diferente não desconta", () => {
  const atributos = [
    { name: "Cor", valores: ["Azul"] },
    { name: "Tamanho", valores: ["PP"] },
  ];

  it("a linha com os dois nomes da grade desconta (controle)", () => {
    expect(
      contarCombinacoesDaGrade(atributos, [
        { name: "Cor / Tamanho", value: "Azul / PP" },
      ]),
    ).toEqual({ porAtributo: [1, 1], novas: 0 });
  });

  it("a linha 'Cor / Material' tem a cor igual mas OUTRO segundo atributo: não desconta", () => {
    expect(
      contarCombinacoesDaGrade(atributos, [
        { name: "Cor / Material", value: "Azul / PP" },
      ]),
    ).toEqual({ porAtributo: [1, 1], novas: 1 });
  });

  it("e a grade cria a combinação de fato (a conta do resumo bate com a geração)", () => {
    const existentes = [{ name: "Cor / Material", value: "Azul / PP" }];
    const gerada = gerarGrade(atributos, existentes);
    expect(gerada.erro).toBeNull();
    expect(gerada.linhas).toEqual([
      { name: "Cor / Tamanho", value: "Azul / PP" },
    ]);
    expect(contarCombinacoesDaGrade(atributos, existentes).novas).toBe(
      gerada.linhas.length,
    );
  });
});
