// Caça de mutação "só testes" (frete, 25/11/2026). `situacaoDaEntrega` é o que
// conta as "coisas que faltam para vender" no selo da tela Frete ("Pronta para
// vender", "Falta 1 coisa", "Faltam N coisas") e só tinha um teste de
// passagem: oito mutantes sobreviviam, entre eles somar errado o selo, acusar
// transportadora que falta numa loja que só atende a cidade, ou deixar passar
// um endereço feito só de espaços. Além disso, a linha "Na sua cidade" lê a
// taxa padrão de R$ 10 quando a config não traz a taxa (é o DEFAULT da coluna
// `local_delivery_fee`), e nenhum teste cobria a config sem o campo.
import { describe, expect, it } from "vitest";

import { situacaoDaEntrega, statusDaEntrega } from "@/lib/status-da-entrega";

type Config = NonNullable<Parameters<typeof situacaoDaEntrega>[0]>;

/** Loja pronta: CEP completo, entrega própria, vende fora, endereço e faixa em dia. */
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

const COM_RETIRADA = ["sedex", "store-pickup"];

describe("situacaoDaEntrega — cada pendência conta uma vez no selo", () => {
  it("loja pronta, com transportadora e pagamento pelo app: zero pendências", () => {
    const r = situacaoDaEntrega(config(), ["Correios"], false);

    expect(r).toMatchObject({
      faltaCep: false,
      faltaTransportadora: false,
      faltaEndereco: false,
      faltaAlcance: false,
      confirmarTransportadoras: false,
      pendencias: 0,
    });
  });

  it("só o CEP incompleto: 1 pendência", () => {
    const r = situacaoDaEntrega(
      config({ originCep: "01310" }),
      ["Correios"],
      false,
    );

    expect(r.faltaCep).toBe(true);
    expect(r.pendencias).toBe(1);
  });

  it("só o pagamento pelo app desligado com transportadora (semPagamento): 1 pendência", () => {
    const r = situacaoDaEntrega(config(), ["Correios"], true);

    expect(r.pendencias).toBe(1);
    expect(r.faltaCep).toBe(false);
    expect(r.faltaTransportadora).toBe(false);
  });

  it("as cinco pendências juntas somam 5", () => {
    const r = situacaoDaEntrega(
      config({
        originCep: "",
        localCepRange: "abc",
        storeAddress: "   ",
        enabledShippingMethods: COM_RETIRADA,
      }),
      [],
      true,
    );

    expect(r).toMatchObject({
      faltaCep: true,
      faltaTransportadora: true,
      faltaEndereco: true,
      faltaAlcance: true,
    });
    expect(r.pendencias).toBe(5);
  });
});

describe("situacaoDaEntrega — transportadora só falta onde a loja vende fora da cidade", () => {
  it("loja que só atende a cidade (cobertura local) sem transportadora: NÃO falta transportadora", () => {
    const r = situacaoDaEntrega(
      config({ shippingCoverage: "local" }),
      [],
      false,
    );

    expect(r.faltaTransportadora).toBe(false);
    expect(r.pendencias).toBe(0);
  });

  it("cobertura nacional e nenhuma transportadora ligada: falta", () => {
    const r = situacaoDaEntrega(config(), [], false);

    expect(r.faltaTransportadora).toBe(true);
  });

  it("cobertura nacional com transportadora ligada: não falta (a lista cheia não é falta)", () => {
    const r = situacaoDaEntrega(config(), ["Correios", "Jadlog"], false);

    expect(r.faltaTransportadora).toBe(false);
  });

  it("lista ainda não lida (null): pede 'a confirmar' e NÃO acusa falta", () => {
    const r = situacaoDaEntrega(config(), null, false);

    expect(r.confirmarTransportadoras).toBe(true);
    expect(r.faltaTransportadora).toBe(false);
  });

  it("lista já lida (com ou sem itens): nunca pede 'a confirmar'", () => {
    expect(
      situacaoDaEntrega(config(), ["Correios"], false).confirmarTransportadoras,
    ).toBe(false);
    expect(
      situacaoDaEntrega(config(), [], false).confirmarTransportadoras,
    ).toBe(false);
  });

  it("cobertura local com lista não lida (null): nada a confirmar (a loja não vende fora)", () => {
    const r = situacaoDaEntrega(
      config({ shippingCoverage: "local" }),
      null,
      false,
    );

    expect(r.confirmarTransportadoras).toBe(false);
  });
});

describe("situacaoDaEntrega — endereço e faixa de CEP", () => {
  it("entrega + retirada com endereço só de espaços: falta o endereço", () => {
    const r = situacaoDaEntrega(
      config({ enabledShippingMethods: COM_RETIRADA, storeAddress: "   " }),
      ["Correios"],
      false,
    );

    expect(r.faltaEndereco).toBe(true);
  });

  it("entrega + retirada com endereço escrito: não falta", () => {
    const r = situacaoDaEntrega(
      config({ enabledShippingMethods: COM_RETIRADA }),
      ["Correios"],
      false,
    );

    expect(r.faltaEndereco).toBe(false);
  });

  it("só entrego (sem retirada), sem endereço: não falta (o endereço é da retirada)", () => {
    const r = situacaoDaEntrega(
      config({ storeAddress: "" }),
      ["Correios"],
      false,
    );

    expect(r.faltaEndereco).toBe(false);
  });

  it("faixa de CEP preenchida sem nenhum número, entrega própria ligada: falta o alcance", () => {
    const r = situacaoDaEntrega(
      config({ localCepRange: "abc" }),
      ["Correios"],
      false,
    );

    expect(r.faltaAlcance).toBe(true);
  });

  it("a mesma faixa sem número com a entrega própria DESLIGADA: não falta (não entrega na cidade)", () => {
    const r = situacaoDaEntrega(
      config({ localCepRange: "abc", localDeliveryEnabled: false }),
      ["Correios"],
      false,
    );

    expect(r.faltaAlcance).toBe(false);
  });

  it("faixa vazia (vale os 5 primeiros números do CEP) e faixa com número: não falta", () => {
    expect(
      situacaoDaEntrega(config({ localCepRange: "" }), ["Correios"], false)
        .faltaAlcance,
    ).toBe(false);
    expect(
      situacaoDaEntrega(
        config({ localCepRange: "38400-38499" }),
        ["Correios"],
        false,
      ).faltaAlcance,
    ).toBe(false);
  });
});

describe("statusDaEntrega — taxa padrão da entrega própria e só-retiro", () => {
  const entrada = (parcial: Partial<Config> = {}) => ({
    config: config(parcial),
    credsErro: false,
    nomesLigados: [] as string[],
  });

  it("config sem a taxa (campo ausente): vale a taxa padrão de R$ 10, não 'Grátis na cidade'", () => {
    const { localDeliveryFee: _semTaxa, ...semTaxa } = config();

    const [local] = statusDaEntrega({
      config: semTaxa as Config,
      credsErro: false,
      nomesLigados: [],
    });

    expect(local.valor).toBe("R$ 10 por entrega");
  });

  it("taxa zero gravada de propósito continua 'Grátis na cidade' (zero não é ausência)", () => {
    const [local] = statusDaEntrega(entrada({ localDeliveryFee: 0 }));

    expect(local.valor).toBe("Grátis na cidade");
  });

  it("só retiro com cobertura local e transportadora 'ligada': fora da cidade vira 'Só retirada'", () => {
    const [, nacional] = statusDaEntrega({
      ...entrada({ localDeliveryEnabled: false, shippingCoverage: "local" }),
      nomesLigados: ["Correios"],
    });

    expect(nacional.valor).toBe("Só retirada");
  });

  it("só retiro, cobertura nacional e NENHUMA transportadora: também 'Só retirada'", () => {
    const [, nacional] = statusDaEntrega(
      entrada({ localDeliveryEnabled: false, shippingCoverage: "national" }),
    );

    expect(nacional.valor).toBe("Só retirada");
  });

  it("só retiro, cobertura nacional e transportadora ligada: mostra a transportadora (não esconde a venda de fora)", () => {
    const [, nacional] = statusDaEntrega({
      ...entrada({ localDeliveryEnabled: false, shippingCoverage: "national" }),
      nomesLigados: ["Correios"],
    });

    expect(nacional.valor).toBe("Correios ligado");
  });
});
