// O selo "% OFF" é uma conta só para todas as telas (`percentualDeDesconto`).
// Os testes que já existiam provam os casos de valor redondo (50 e 100, 70 e
// 50); estes provam as BORDAS onde a conta mente se alguém trocar o
// arredondamento: centavos que a vírgula flutuante estraga (1,13 × 100 vira
// 112,99999999999999), o meio por cento, o teto de 99, o preço zero e a
// entrada que não é número.
import { describe, expect, it } from "vitest";

import { percentualDeDesconto } from "@/lib/percentual-de-desconto";

describe("percentualDeDesconto - centavos que a vírgula flutuante estraga", () => {
  // Em cada par, `preco * 100` NÃO dá inteiro (1,13 -> 112,99999999999999;
  // 0,29 -> 28,999999999999996). Se a conta cortasse (floor) em vez de
  // arredondar os centavos, o selo sairia 1 ponto abaixo (original) ou acima
  // (atual) do valor certo, e a cliente veria o desconto mudar de tela em tela.
  it.each([
    [1.13, 0.22, 81],
    [1.13, 0.5, 56],
    [1.13, 0.57, 50],
    [1.13, 0.78, 31],
    [1.0, 0.29, 71],
    [1.0, 0.57, 43],
    [1.02, 0.29, 72],
  ])("De %s por %s é %i%%", (original, atual, esperado) => {
    expect(percentualDeDesconto(original, atual)).toBe(esperado);
  });
});

describe("percentualDeDesconto - arredondamento do percentual", () => {
  it("o meio por cento arredonda PARA CIMA (22,5% vira 23%, nunca 22%)", () => {
    expect(percentualDeDesconto(40, 31)).toBe(23);
  });

  it("22,4% arredonda para baixo e 22,6% para cima (não corta nem sobe sempre)", () => {
    // 22,4%: De 1000,00 por 776,00. 22,6%: De 1000,00 por 774,00.
    expect(percentualDeDesconto(1000, 776)).toBe(22);
    expect(percentualDeDesconto(1000, 774)).toBe(23);
  });

  it("meio por cento de desconto ainda é 1% (existe selo); abaixo disso é 0 (sem selo)", () => {
    expect(percentualDeDesconto(1000, 995)).toBe(1);
    expect(percentualDeDesconto(1000, 995.1)).toBe(0);
  });

  it("um centavo de desconto num produto caro não vira selo", () => {
    expect(percentualDeDesconto(100, 99.99)).toBe(0);
  });
});

describe("percentualDeDesconto - preço atual na fronteira do original", () => {
  it("preço igual ao antigo não é desconto: sem selo", () => {
    expect(percentualDeDesconto(50, 50)).toBe(0);
  });

  it("igual em centavos mesmo com ruído de vírgula flutuante: sem selo", () => {
    // 0,1 + 0,2 = 0,30000000000000004: é "0,30" na tela, igual ao antigo.
    expect(percentualDeDesconto(0.3, 0.1 + 0.2)).toBe(0);
  });

  it("preço MAIOR que o antigo (promoção vencida) não tem selo", () => {
    expect(percentualDeDesconto(50, 60)).toBe(0);
  });

  it("um centavo abaixo do antigo, num preço barato, já tem selo", () => {
    // De 0,10 por 0,09 = 10%.
    expect(percentualDeDesconto(0.1, 0.09)).toBe(10);
  });
});

describe("percentualDeDesconto - teto de 99 e preço zero", () => {
  it("99,6% arredondaria para 100 mas o selo para em 99 (100% só no grátis)", () => {
    // De 1000,00 por 4,00 = 99,6%.
    expect(percentualDeDesconto(1000, 4)).toBe(99);
    // De 1000,00 por 0,01 = 99,999%.
    expect(percentualDeDesconto(1000, 0.01)).toBe(99);
  });

  it("preço zero é 100% (a única forma de chegar a 100)", () => {
    expect(percentualDeDesconto(50, 0)).toBe(100);
    expect(percentualDeDesconto(0.01, 0)).toBe(100);
  });

  it("preço atual negativo não produz selo", () => {
    expect(percentualDeDesconto(50, -1)).toBe(0);
    expect(percentualDeDesconto(50, -0.01)).toBe(0);
  });
});

describe("percentualDeDesconto - entrada inválida nunca vira selo", () => {
  it.each([
    ["original zero", 0, 0],
    ["original zero, atual positivo", 0, 10],
    ["original negativo", -5, -10],
    ["original negativo, atual zero", -5, 0],
    ["original NaN", Number.NaN, 10],
    ["atual NaN", 50, Number.NaN],
    ["original infinito", Number.POSITIVE_INFINITY, 10],
    ["atual infinito", 50, Number.POSITIVE_INFINITY],
    ["original nulo", null, 10],
    ["atual nulo", 50, null],
    ["original ausente", undefined, 10],
    ["atual ausente", 50, undefined],
  ])("%s -> 0", (_nome, original, atual) => {
    expect(percentualDeDesconto(original, atual)).toBe(0);
  });

  it("texto no lugar do número (dado sujo do banco) -> 0", () => {
    expect(
      percentualDeDesconto(
        "100" as unknown as number,
        "50" as unknown as number,
      ),
    ).toBe(0);
  });
});
