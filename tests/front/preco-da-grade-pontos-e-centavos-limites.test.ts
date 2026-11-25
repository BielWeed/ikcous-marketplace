// `src/utils/preco-da-grade.ts`: duas bordas que a suíte de
// `preco-da-grade.test.ts` não fixava.
//
//  - `limparNumero` com 2 ou mais pontos e sem vírgula: só o PRIMEIRO ponto é
//    decimal, os demais são descartados ("1.2.3" vira "1.23"). Sem isto, a
//    segunda passada da grade (que relê a saída) veria um número quebrado.
//  - `resolverPrecoDaGrade` compara o menor preço com as linhas EM CENTAVOS
//    arredondados: "19.999" e "20" são o mesmo preço de loja (R$ 20,00) e as
//    duas linhas seguem o produto (Auto).
import { limparNumero, resolverPrecoDaGrade } from "@/utils/preco-da-grade";
import { describe, expect, it } from "vitest";

describe("limparNumero — vários pontos sem vírgula", () => {
  it("dois pontos: o primeiro é decimal e o outro é descartado", () => {
    expect(limparNumero("1.2.3")).toBe("1.23");
  });

  it("três pontos: todos depois do primeiro são descartados", () => {
    expect(limparNumero("1.2.3.4")).toBe("1.234");
  });

  it("um ponto só fica como está (controle)", () => {
    expect(limparNumero("1.5")).toBe("1.5");
  });
});

describe("resolverPrecoDaGrade — igualdade em centavos arredondados", () => {
  it("19.999 e 20 são o mesmo preço em centavos: as duas linhas viram Auto", () => {
    const { precos } = resolverPrecoDaGrade("", ["19.999", "20"]);
    expect(precos).toEqual([undefined, undefined]);
  });

  it("19.99 e 20 são preços diferentes: só a mais barata vira Auto (controle)", () => {
    const { precos, precoDoProduto } = resolverPrecoDaGrade("", [
      "19.99",
      "20",
    ]);
    expect(precos).toEqual([undefined, 20]);
    expect(precoDoProduto).toBe(19.99);
  });
});
