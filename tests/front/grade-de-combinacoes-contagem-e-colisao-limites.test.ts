// `src/utils/grade-de-combinacoes.ts`: o que `grade-de-combinacoes.test.ts` não
// segurava.
//
//  - `contarCombinacoesDaGrade` (a conta ao vivo "3 × 3 = 9 novas" do passo 1)
//    não tinha teste nenhum: sem atributo é zero nova; só desconta a linha
//    existente que é a MESMA combinação (mesmos atributos na mesma ordem, mesmo
//    valor, ignorando caixa e espaço); linha de outra forma não é descontada;
//    valor vazio não conta como valor.
//  - a identidade de uma linha que já existe ignora espaço em volta do valor;
//  - `skusDaGrade` não deixa hífen sobrando quando um pedaço do valor é vazio;
//  - `primeiroSkuEmColisao` ignora caixa e espaço dos DOIS lados.
import {
  type AtributoDaGrade,
  contarCombinacoesDaGrade,
  gerarGrade,
  primeiroSkuEmColisao,
  skusDaGrade,
} from "@/utils/grade-de-combinacoes";
import { describe, expect, it } from "vitest";

const atributo = (name: string, ...valores: string[]): AtributoDaGrade => ({
  name,
  valores,
});

const CORES = atributo("Cor", "Azul", "Verde");

describe("contarCombinacoesDaGrade — o que conta como nova", () => {
  it("sem nenhum atributo não há combinação nova, haja ou não linha no produto", () => {
    expect(contarCombinacoesDaGrade([], [])).toEqual({
      porAtributo: [],
      novas: 0,
    });
    expect(
      contarCombinacoesDaGrade([], [{ name: "Cor", value: "Azul" }]),
    ).toEqual({ porAtributo: [], novas: 0 });
  });

  it("produto sem linhas: todas as combinações são novas", () => {
    expect(
      contarCombinacoesDaGrade([CORES, atributo("Tamanho", "P", "M", "G")], []),
    ).toEqual({ porAtributo: [2, 3], novas: 6 });
  });

  it("linha que já existe (ignorando caixa e espaço) sai da conta", () => {
    expect(
      contarCombinacoesDaGrade([CORES], [{ name: " cor ", value: "  azul " }]),
    ).toEqual({ porAtributo: [2], novas: 1 });
  });

  it("linha com valor que NÃO está na grade não desconta nada", () => {
    expect(
      contarCombinacoesDaGrade([CORES], [{ name: "Cor", value: "Roxo" }]).novas,
    ).toBe(2);
  });

  it("linha de outro atributo, mesmo com valor igual, não desconta nada", () => {
    expect(
      contarCombinacoesDaGrade([CORES], [{ name: "Estampa", value: "Azul" }])
        .novas,
    ).toBe(2);
  });

  it("linha com menos atributos que a grade não desconta nada", () => {
    const grade = [atributo("Cor", "Azul"), atributo("Tamanho", "PP")];
    expect(
      contarCombinacoesDaGrade(grade, [{ name: "Cor", value: "Azul / PP" }])
        .novas,
    ).toBe(1);
  });

  it("linha com menos valores que atributos no nome não desconta nada", () => {
    const grade = [atributo("Cor", "Azul"), atributo("Tamanho", "PP")];
    expect(
      contarCombinacoesDaGrade(grade, [
        { name: "Cor / Tamanho", value: "Azul" },
      ]).novas,
    ).toBe(1);
  });

  it("a combinação completa que já existe desconta uma, não mais", () => {
    const grade = [atributo("Cor", "Azul"), atributo("Tamanho", "PP", "P")];
    expect(
      contarCombinacoesDaGrade(grade, [
        { name: "Cor / Tamanho", value: "Azul / PP" },
      ]),
    ).toEqual({ porAtributo: [1, 2], novas: 1 });
  });

  it("valor vazio ou só espaço não conta como valor do atributo", () => {
    expect(
      contarCombinacoesDaGrade([atributo("Cor", "Azul", "  ", "")], [])
        .porAtributo,
    ).toEqual([1]);
  });

  it("atributo sem valor nenhum zera as novas", () => {
    expect(
      contarCombinacoesDaGrade([CORES, atributo("Tamanho", " ")], []),
    ).toEqual({ porAtributo: [2, 0], novas: 0 });
  });
});

describe("gerarGrade — identidade da linha que já existe", () => {
  it("valor existente com espaço em volta é a mesma combinação: a grade não recria", () => {
    const { linhas, erro } = gerarGrade(
      [atributo("Cor", "Azul")],
      [{ name: "Cor", value: "  Azul " }],
    );
    expect(erro).toBeNull();
    expect(linhas).toEqual([]);
  });
});

describe("skusDaGrade — pedaço vazio do valor", () => {
  it("valor com pedaço vazio não deixa hífen sobrando no código", () => {
    expect(
      skusDaGrade("blu", [{ name: "Cor / Tamanho", value: "Azul / " }]),
    ).toEqual(["BLU-AZU"]);
  });
});

describe("primeiroSkuEmColisao — caixa e espaço", () => {
  it("minúsculas do lote colidem com maiúsculas já ocupadas", () => {
    expect(primeiroSkuEmColisao(["blu-p"], ["BLU-P"])).toBe("blu-p");
  });

  it("código ocupado com espaço em volta ainda colide", () => {
    expect(primeiroSkuEmColisao(["BLU-P"], ["  BLU-P "])).toBe("BLU-P");
  });

  it("devolve o PRIMEIRO do lote que colide, na ordem do lote", () => {
    expect(
      primeiroSkuEmColisao(["BLU-A", "BLU-B", "BLU-C"], ["BLU-C", "BLU-B"]),
    ).toBe("BLU-B");
  });

  it("sku vazio no lote nunca colide, mesmo com ocupado vazio", () => {
    expect(primeiroSkuEmColisao(["", "BLU-A"], ["", "   "])).toBeNull();
  });
});
