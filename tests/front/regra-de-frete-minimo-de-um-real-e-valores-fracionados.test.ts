// Fronteira do "frete grátis a partir de": o menor mínimo possível (R$ 1 e
// centavos) liga a regra, e zero ou negativo continuam sendo "sem regra por
// valor". Um limiar trocado de `> 0` para `> 1` deixava a tela dizendo
// "Nenhuma regra por valor" para uma loja que oferece frete grátis a partir de
// R$ 1 — e nenhum teste dava por falta.
import { describe, expect, it } from "vitest";

import { frasesDaRegraDeFrete } from "@/utils/regra-de-frete";

const nacionalComTaxaFixa = {
  shippingCoverage: "national",
  shippingProvider: "flat_fee",
} as const;

describe("frasesDaRegraDeFrete — mínimo de frete grátis nas bordas", () => {
  it("mínimo de exatamente R$ 1 liga a regra por valor", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 1,
      shippingFee: 10,
      ...nacionalComTaxaFixa,
    });

    expect(f.freteGratis).toContain("a partir de R$ 1. ");
    expect(f.freteGratis).not.toContain("Nenhuma regra por valor");
  });

  it("mínimo abaixo de R$ 1 (50 centavos) também liga a regra e sai com vírgula", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 0.5,
      shippingFee: 10,
      ...nacionalComTaxaFixa,
    });

    expect(f.freteGratis).toContain("a partir de R$ 0,50. ");
  });

  it("mínimo de 1 centavo liga a regra", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 0.01,
      shippingFee: 10,
      ...nacionalComTaxaFixa,
    });

    expect(f.freteGratis).toContain("a partir de R$ 0,01. ");
  });

  it("mínimo zero e mínimo negativo são 'sem regra por valor'", () => {
    for (const freeShippingMin of [0, -1, -0.01]) {
      const f = frasesDaRegraDeFrete({
        freeShippingMin,
        shippingFee: 10,
        ...nacionalComTaxaFixa,
      });

      expect(f.freteGratis, `min=${freeShippingMin}`).toContain(
        "Nenhuma regra por valor",
      );
      expect(f.freteGratis, `min=${freeShippingMin}`).not.toContain(
        "a partir de",
      );
    }
  });

  it("taxa de 50 centavos cobra (não é taxa zero) e não dispara o aviso de entrega gratuita", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 0,
      shippingFee: 0.5,
      ...nacionalComTaxaFixa,
    });

    expect(f.taxa).toContain("a entrega custa R$ 0,50.");
    expect(f.avisoDeEntregaGratuita).toBeNull();
  });

  it("taxa de exatamente R$ 1 cobra", () => {
    const f = frasesDaRegraDeFrete({
      freeShippingMin: 0,
      shippingFee: 1,
      ...nacionalComTaxaFixa,
    });

    expect(f.taxa).toContain("a entrega custa R$ 1.");
  });
});
