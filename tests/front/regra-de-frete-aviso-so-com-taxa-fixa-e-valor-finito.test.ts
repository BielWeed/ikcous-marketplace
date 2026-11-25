// `frasesDaRegraDeFrete` (`src/utils/regra-de-frete.ts`): duas bordas que
// `admin-shipping-frases-da-regra.test.ts` deixava passar.
//
//  1. O aviso de "entrega grátis para o país inteiro" só vale com a taxa FIXA
//     (`flat_fee`) governando o preço. Frenet e SuperFrete cotam pela
//     transportadora, como o Melhor Envio: nenhum deles pode disparar o aviso.
//  2. Dinheiro que não é número finito (campo corrompido que chega como
//     Infinity) nunca vira "R$ Infinity" na tela da lojista.
import {
  type EstadoDaRegraDeFrete,
  frasesDaRegraDeFrete,
} from "@/utils/regra-de-frete";
import { describe, expect, it } from "vitest";

const base: EstadoDaRegraDeFrete = {
  freeShippingMin: 0,
  shippingFee: 0,
  shippingCoverage: "national",
  shippingProvider: "flat_fee",
};

describe("avisoDeEntregaGratuita — só com a taxa fixa nacional e zerada", () => {
  it("taxa fixa nacional com taxa em R$ 0 avisa (controle: o aviso existe)", () => {
    expect(frasesDaRegraDeFrete(base).avisoDeEntregaGratuita).not.toBeNull();
  });

  it.each(["melhor_envio", "frenet", "superfrete"] as const)(
    "cotação pela transportadora (%s) com taxa em R$ 0 NÃO avisa",
    (shippingProvider) => {
      const frases = frasesDaRegraDeFrete({ ...base, shippingProvider });
      expect(frases.avisoDeEntregaGratuita).toBeNull();
    },
  );

  it("taxa fixa com cobertura local NÃO avisa", () => {
    const frases = frasesDaRegraDeFrete({ ...base, shippingCoverage: "local" });
    expect(frases.avisoDeEntregaGratuita).toBeNull();
  });
});

describe("reais — valor que não é número finito", () => {
  it("mínimo e taxa infinitos não escrevem 'Infinity' nem 'NaN' nas frases", () => {
    const frases = frasesDaRegraDeFrete({
      ...base,
      freeShippingMin: Number.POSITIVE_INFINITY,
      shippingFee: Number.POSITIVE_INFINITY,
    });
    expect(frases.freteGratis).not.toMatch(/Infinity|NaN/);
    expect(frases.taxa).not.toMatch(/Infinity|NaN/);
  });
});
