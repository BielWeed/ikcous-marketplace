// Caça por mutação em `percentualDeDesconto` (selo "% OFF" de toda a loja).
// Sobrevivia a troca de `Math.round(precoOriginal * 100)` por
// `precoOriginal * 100`: em reais com vírgula flutuante a conta fica 1 ponto
// abaixo no meio por cento — o selo diria "62%" onde a conta certa é 62,5% →
// "63%", e as telas voltariam a divergir entre si. Idem no preço atual.
import { percentualDeDesconto } from "@/lib/percentual-de-desconto";
import { describe, expect, it } from "vitest";

describe("percentualDeDesconto — meio por cento exato arredonda para cima", () => {
  it.each([
    // [original, atual, selo]: (232-87)/232 = 62,5% exatos em centavos.
    [2.32, 0.87, 63],
    [2.32, 1.45, 38],
    [2.32, 2.03, 13],
    [4.56, 1.71, 63],
    [4.56, 2.85, 38],
    [4.56, 3.99, 13],
    // Aqui o ruído binário está no preço ATUAL: 1,11 * 100 = 111,00000000000001.
    [1.2, 1.11, 8], // 7,5%
    [2, 1.09, 46], // 45,5%
  ])("de %s por %s o selo é %s%%", (original, atual, selo) => {
    expect(percentualDeDesconto(original, atual)).toBe(selo);
  });

  it("0,5% exato vira 1%, e 0,4% continua sem selo", () => {
    expect(percentualDeDesconto(200, 199)).toBe(1);
    expect(percentualDeDesconto(200, 199.2)).toBe(0);
  });
});

describe("percentualDeDesconto — sem desconto, sem selo", () => {
  it("preço igual ou maior que o original não tem selo", () => {
    expect(percentualDeDesconto(100, 100)).toBe(0);
    expect(percentualDeDesconto(100, 120)).toBe(0);
  });

  it("original zero, negativo ou ausente não divide por zero", () => {
    expect(percentualDeDesconto(0, 0)).toBe(0);
    expect(percentualDeDesconto(0, 10)).toBe(0);
    expect(percentualDeDesconto(-10, -20)).toBe(0);
    expect(percentualDeDesconto(null, 10)).toBe(0);
    expect(percentualDeDesconto(100, undefined)).toBe(0);
    expect(percentualDeDesconto(Number.NaN, 10)).toBe(0);
    expect(percentualDeDesconto(100, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("preço atual negativo não vira desconto de mais de 100%", () => {
    expect(percentualDeDesconto(100, -5)).toBe(0);
  });

  it("de graça é 100%, e 99,9% nunca passa de 99 (o 100 é só do grátis)", () => {
    expect(percentualDeDesconto(100, 0)).toBe(100);
    expect(percentualDeDesconto(1000, 0.01)).toBe(99);
  });
});
