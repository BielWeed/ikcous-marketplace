// Valor de frete digitado pela lojista, como o banco guarda (`numeric(10,2)`):
// o que não é número de verdade (campo apagado vira NaN, conta que estourou vira
// Infinity) grava R$ 0,00 — NUNCA R$ 0,01 nem um valor inventado — e o que é
// número vai para centavos inteiros, limitado ao máximo da coluna.
import { describe, expect, it } from "vitest";

import {
  FRETE_VALOR_MAXIMO,
  valorDeFreteEmCentavos,
} from "@/lib/presets-de-frete-gratis";

describe("valorDeFreteEmCentavos", () => {
  it.each([
    ["NaN (campo apagado)", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["menos infinito", Number.NEGATIVE_INFINITY],
  ])("%s grava zero", (_nome, valor) => {
    expect(valorDeFreteEmCentavos(valor)).toBe(0);
  });

  it.each([
    [0, 0],
    [12.9, 12.9],
    [49.999, 50],
    [12.344, 12.34],
    [0.1 + 0.2, 0.3],
  ])("%s grava %s (centavos inteiros)", (valor, gravado) => {
    expect(valorDeFreteEmCentavos(valor)).toBe(gravado);
  });

  it("nunca passa do máximo da coluna", () => {
    expect(valorDeFreteEmCentavos(FRETE_VALOR_MAXIMO)).toBe(FRETE_VALOR_MAXIMO);
    expect(valorDeFreteEmCentavos(FRETE_VALOR_MAXIMO + 1)).toBe(
      FRETE_VALOR_MAXIMO,
    );
    expect(valorDeFreteEmCentavos(1e12)).toBe(FRETE_VALOR_MAXIMO);
  });
});
