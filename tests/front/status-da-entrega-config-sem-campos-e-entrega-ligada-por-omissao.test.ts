// Caça por mutação (frete, 25/11/2026): duas leituras do config que nenhum teste
// prendia, porque o config de teste sempre trazia todos os campos:
//  - config SEM `freeShippingMin` (ou sem config nenhum) é "frete grátis
//    desligado" — o valor padrão é 0, nunca um limiar inventado que faria a
//    faixa dizer "Acima de R$ 1";
//  - entrega própria com `localDeliveryEnabled` ausente/nulo conta como LIGADA
//    (só `false` desliga): uma faixa de CEP sem número nenhum continua sendo
//    pendência.
import { describe, expect, it } from "vitest";

import { situacaoDaEntrega, statusDaEntrega } from "@/lib/status-da-entrega";

type Config = NonNullable<Parameters<typeof situacaoDaEntrega>[0]>;

function config(parcial: Partial<Config> = {}): Config {
  return {
    originCep: "01310-100",
    localCepRange: "",
    freeShippingMin: 0,
    localDeliveryFee: 10,
    shippingCoverage: "national",
    storeCity: "Monte Carmelo",
    storeState: "MG",
    storeAddress: "Rua das Flores, 10",
    localDeliveryEnabled: true,
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
    ...parcial,
  };
}

describe("statusDaEntrega: frete grátis quando o config não traz o limiar", () => {
  it("config sem `freeShippingMin` é grátis DESLIGADO, não 'Acima de R$ ...'", () => {
    const semLimiar = {
      ...config(),
      freeShippingMin: undefined,
    } as unknown as Config;

    const [, , gratis] = statusDaEntrega({
      config: semLimiar,
      credsErro: false,
      nomesLigados: ["Correios"],
    });

    expect(gratis).toMatchObject({
      rotulo: "Frete grátis local",
      valor: "Desligado",
      tom: "neutro",
    });
  });

  it("sem config nenhum: grátis desligado e a cidade parada por falta de CEP", () => {
    const [local, , gratis] = statusDaEntrega({
      config: null,
      credsErro: false,
      nomesLigados: [],
    });

    expect(local.valor).toBe("Parado — falta o CEP da loja");
    expect(gratis.valor).toBe("Desligado");
  });
});

describe("situacaoDaEntrega: entrega própria ligada por omissão", () => {
  it.each([undefined, null])(
    "localDeliveryEnabled=%s com faixa sem número continua pendente",
    (ligada) => {
      const r = situacaoDaEntrega(
        config({
          localDeliveryEnabled: ligada as unknown as boolean,
          localCepRange: "toda a cidade",
        }),
        ["Correios"],
        false,
      );

      expect(r.faltaAlcance).toBe(true);
      expect(r.pendencias).toBe(1);
    },
  );

  it("só `false` desliga a entrega própria: a mesma faixa não pende", () => {
    const r = situacaoDaEntrega(
      config({ localDeliveryEnabled: false, localCepRange: "toda a cidade" }),
      ["Correios"],
      false,
    );

    expect(r.faltaAlcance).toBe(false);
  });
});
