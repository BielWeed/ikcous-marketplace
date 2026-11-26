// `skusDaGrade` (SKU gerado para cada linha da grade de variantes): o espaço
// nas PONTAS do texto some, só o espaço do MEIO vira hífen. Sem aparar antes,
// um SKU-base colado com um espaço sobrando ("blu ") sairia "BLU--AMA" (dois
// hífens), um espaço antes ("  blu") sairia "-BLU-AMA", e uma base só de
// espaços deixaria de valer como "sem SKU" e geraria "-" no lugar do vazio —
// código que o lojista nunca digitou e que o banco aceitaria como SKU. A
// conferência de colisão (`primeiroSkuEmColisao`) também ignora o espaço nas
// pontas do SKU da grade, senão " abc " passaria por livre contra o "ABC" que
// outro produto já tem — e o banco derrubaria o lote inteiro.
import {
  primeiroSkuEmColisao,
  skusDaGrade,
} from "@/utils/grade-de-combinacoes";
import { describe, expect, it } from "vitest";

const linhas = [{ name: "Cor", value: "Amarela" }];

describe("skusDaGrade — espaço nas pontas", () => {
  it("espaço sobrando no fim da base não vira hífen", () => {
    expect(skusDaGrade("blu ", linhas)).toEqual(["BLU-AMA"]);
  });

  it("espaço sobrando no começo da base não vira hífen", () => {
    expect(skusDaGrade("  blu", linhas)).toEqual(["BLU-AMA"]);
  });

  it("base só com espaços vale como base vazia: linha sem SKU", () => {
    expect(skusDaGrade("   ", linhas)).toEqual([""]);
  });

  it("espaço nas pontas do valor também é aparado antes do sufixo", () => {
    expect(
      skusDaGrade("BLU", [{ name: "Cor / Tamanho", value: " Amarela / P " }]),
    ).toEqual(["BLU-AMA-P"]);
  });

  it("controle: espaço no MEIO da base continua virando hífen", () => {
    expect(skusDaGrade("blu ray", linhas)).toEqual(["BLU-RAY-AMA"]);
  });
});

describe("primeiroSkuEmColisao — espaço nas pontas do SKU da grade", () => {
  it("' abc ' colide com o 'ABC' que já existe, e devolve o SKU como veio", () => {
    expect(primeiroSkuEmColisao([" abc "], ["ABC"])).toBe(" abc ");
  });

  it("controle: SKU diferente não colide", () => {
    expect(primeiroSkuEmColisao([" abd "], ["ABC"])).toBeNull();
  });
});
