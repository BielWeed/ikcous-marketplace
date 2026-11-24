// Duas fronteiras da regra de frete grátis que nenhum teste vizinho segurava
// (achadas por mutação, 24/11/2026):
//
// 1. O preset "sempre" é a sentinela R$ 0,01 e NADA além dela. Um mínimo real
//    de R$ 0,02 (ou R$ 0,50) é "acima de um valor". Se a sentinela virasse
//    "tudo até 0,50", a loja que pediu "frete grátis acima de R$ 0,50" passaria
//    a dar frete grátis em qualquer pedido, sem a lojista saber.
// 2. "Só retiro" com cobertura LOCAL não tem transportadora, mesmo que a lista
//    de serviços gravada ainda guarde sedex/pac de antes. Com a cobertura
//    nacional, a mesma lista MANTÉM a transportadora — aí há entrega a que o
//    "frete grátis" se refira.
import { semMetaDeFreteGratis } from "@/lib/estrategias-de-frete";
import {
  FRETE_GRATIS_POR_PRODUTO,
  FRETE_GRATIS_SEMPRE,
  presetDoConfig,
} from "@/lib/presets-de-frete-gratis";
import { describe, expect, it } from "vitest";

describe("presetDoConfig — a sentinela do 'sempre' é só R$ 0,01", () => {
  it("0 desliga, 0,01 é 'sempre', e o primeiro mínimo de verdade (0,02) já é 'acima de valor'", () => {
    expect(presetDoConfig(0)).toBe("desligado");
    expect(presetDoConfig(FRETE_GRATIS_SEMPRE)).toBe("sempre");
    expect(presetDoConfig(0.02)).toBe("acima_de_valor");
    expect(presetDoConfig(0.5)).toBe("acima_de_valor");
    expect(presetDoConfig(100)).toBe("acima_de_valor");
  });

  it("qualquer valor negativo é 'por produto' (a sentinela é -1, mas o sinal é o que vale)", () => {
    expect(presetDoConfig(FRETE_GRATIS_POR_PRODUTO)).toBe("por_produto");
    expect(presetDoConfig(-0.01)).toBe("por_produto");
  });
});

describe("semMetaDeFreteGratis — 'Só retiro' sem transportadora", () => {
  const SO_RETIRO = { localDeliveryEnabled: false } as const;

  it("cobertura LOCAL: não há transportadora nem com sedex/pac sobrando na lista gravada", () => {
    expect(
      semMetaDeFreteGratis({
        ...SO_RETIRO,
        shippingCoverage: "local",
        enabledShippingMethods: ["sedex", "pac", "store-pickup"],
      }),
    ).toBe(true);
  });

  it("cobertura NACIONAL com transportadora na lista: há entrega, a meta de frete grátis segue valendo", () => {
    expect(
      semMetaDeFreteGratis({
        ...SO_RETIRO,
        shippingCoverage: "national",
        enabledShippingMethods: ["sedex", "store-pickup"],
      }),
    ).toBe(false);
  });

  it("cobertura nacional (ou ausente, que lê como nacional) com SÓ a retirada na lista: sem transportadora", () => {
    expect(
      semMetaDeFreteGratis({
        ...SO_RETIRO,
        shippingCoverage: "national",
        enabledShippingMethods: ["store-pickup"],
      }),
    ).toBe(true);
    expect(
      semMetaDeFreteGratis({
        ...SO_RETIRO,
        enabledShippingMethods: ["store-pickup"],
      }),
    ).toBe(true);
  });

  it("lista ausente lê como sedex+pac na edge: há transportadora, nunca 'sem meta'", () => {
    expect(
      semMetaDeFreteGratis({
        ...SO_RETIRO,
        shippingCoverage: "national",
        enabledShippingMethods: null,
      }),
    ).toBe(false);
  });

  it("loja que ENTREGA na cidade nunca é 'sem meta', mesmo com cobertura local", () => {
    expect(
      semMetaDeFreteGratis({
        localDeliveryEnabled: true,
        shippingCoverage: "local",
        enabledShippingMethods: ["store-pickup"],
      }),
    ).toBe(false);
  });
});
