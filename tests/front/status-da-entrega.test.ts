// A régua do status da entrega (src/lib/status-da-entrega.ts): as três linhas
// da faixa-resumo da tela "Entrega e frete" — "Na sua cidade", "Fora da
// cidade" e "Frete grátis local". Era um `useMemo` dentro de
// AdminShippingView; extraída para que a tela e quem mais precisar contem a
// mesma história (regra escrita em dois lugares diverge).
import { statusDaEntrega } from "@/lib/status-da-entrega";
import { describe, expect, it } from "vitest";

type Entrada = Parameters<typeof statusDaEntrega>[0];
type Config = NonNullable<Entrada["config"]>;

/** Loja pronta: CEP, entrega própria de R$ 10, estratégia nacional desligada. */
function config(parcial: Partial<Config> = {}): Config {
  return {
    originCep: "01310-100",
    freeShippingMin: 0,
    localDeliveryFee: 10,
    shippingCoverage: "national",
    storeCity: "Monte Carmelo",
    storeState: "MG",
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
    ...parcial,
  };
}

function entrada(parcial: Partial<Entrada> = {}): Entrada {
  return {
    config: config(),
    credsErro: false,
    nomesLigados: [],
    ...parcial,
  };
}

describe("statusDaEntrega — Na sua cidade", () => {
  it("sem CEP da loja: parado, e a nota manda para Minha loja", () => {
    const [local] = statusDaEntrega(
      entrada({ config: config({ originCep: "" }) }),
    );
    expect(local.rotulo).toBe("Na sua cidade");
    expect(local.valor).toBe("Parado — falta o CEP da loja");
    expect(local.detalhe).toContain("Minha loja");
    expect(local.detalhe).not.toMatch(/configure abaixo/i);
    expect(local.tom).toBe("atencao");
  });

  it("config ausente também é 'sem CEP' (a faixa nunca inventa funcionamento)", () => {
    const [local] = statusDaEntrega(entrada({ config: null }));
    expect(local.tom).toBe("atencao");
    expect(local.valor).toContain("falta o CEP");
  });

  it("com CEP e taxa: mostra o valor por entrega e os CEPs que a entrega alcança (não a cidade)", () => {
    const [local] = statusDaEntrega(entrada());
    expect(local.valor).toBe("R$ 10 por entrega");
    // Alcance vazio = só os 5 primeiros números do CEP da loja (01310-100).
    expect(local.detalhe).toBe("Entrega própria em CEPs que começam com 01310");
    expect(local.detalhe).not.toContain("Monte Carmelo");
    expect(local.tom).toBe("positivo");
  });

  it("taxa com centavos usa vírgula; taxa zero vira 'Grátis na cidade'", () => {
    expect(
      statusDaEntrega(entrada({ config: config({ localDeliveryFee: 7.5 }) }))[0]
        .valor,
    ).toBe("R$ 7,50 por entrega");
    expect(
      statusDaEntrega(entrada({ config: config({ localDeliveryFee: 0 }) }))[0]
        .valor,
    ).toBe("Grátis na cidade");
  });

  it("a promessa nunca é o nome da cidade, com ou sem cidade/UF na config", () => {
    for (const parcial of [
      { storeCity: null, storeState: null },
      { storeCity: "Uberlândia", storeState: null },
      { storeCity: "Uberlândia", storeState: "MG" },
    ]) {
      const [local] = statusDaEntrega(entrada({ config: config(parcial) }));
      expect(local.detalhe, JSON.stringify(parcial)).toBe(
        "Entrega própria em CEPs que começam com 01310",
      );
    }
  });

  it("alcance escrito sem número nenhum: diz que nenhum CEP entra e pede atenção (não 'positivo')", () => {
    const [local] = statusDaEntrega(
      entrada({ config: config({ localCepRange: "abc" }) }),
    );
    expect(local.detalhe).toBe(
      "Entrega própria em nenhum CEP: o que está escrito não tem números",
    );
    expect(local.tom).toBe("atencao");
    // Vazio de verdade (ou só espaços) segue sendo a região da loja, positivo.
    const [vazio] = statusDaEntrega(
      entrada({ config: config({ localCepRange: "  " }) }),
    );
    expect(vazio.tom).toBe("positivo");
  });

  it("diz a abrangência real do alcance escrito: um prefixo, ou 'os CEPs que você escolheu'", () => {
    const detalhe = (localCepRange: string | undefined) =>
      statusDaEntrega(entrada({ config: config({ localCepRange }) }))[0]
        .detalhe;
    expect(detalhe("38400")).toBe(
      "Entrega própria em CEPs que começam com 38400",
    );
    expect(detalhe("")).toBe("Entrega própria em CEPs que começam com 01310");
    for (const escrito of [
      "38400, 38500",
      "38400-000, 38409-999",
      "38400000-38409999",
    ]) {
      expect(detalhe(escrito), escrito).toBe(
        "Entrega própria em CEPs que você escolheu",
      );
    }
  });
});

describe("statusDaEntrega — Fora da cidade", () => {
  it("cobertura só local: a loja não atende fora", () => {
    const [, nacional] = statusDaEntrega(
      entrada({ config: config({ shippingCoverage: "local" }) }),
    );
    expect(nacional.rotulo).toBe("Fora da cidade");
    expect(nacional.valor).toBe("Só na sua cidade");
    expect(nacional.tom).toBe("neutro");
  });

  it("sem transportadora ligada: atenção, 'Sem transportadora'", () => {
    const [, nacional] = statusDaEntrega(entrada());
    expect(nacional.valor).toBe("Sem transportadora");
    expect(nacional.tom).toBe("atencao");
  });

  it("uma transportadora ligada: o nome dela, tom positivo", () => {
    const [, nacional] = statusDaEntrega(
      entrada({ nomesLigados: ["Melhor Envio"] }),
    );
    expect(nacional.valor).toBe("Melhor Envio ligado");
    expect(nacional.detalhe).toBe("cotação real na hora");
    expect(nacional.tom).toBe("positivo");
  });

  it("várias ligadas: conta os provedores", () => {
    const [, nacional] = statusDaEntrega(
      entrada({ nomesLigados: ["Melhor Envio", "Frenet"] }),
    );
    expect(nacional.valor).toBe("2 provedores ligados");
  });

  it("estratégia nacional ligada entra no detalhe", () => {
    const [, nacional] = statusDaEntrega(
      entrada({
        nomesLigados: ["Frenet"],
        config: config({
          nationalShippingStrategy: "sempre",
          nationalBenefitScope: "todas",
        }),
      }),
    );
    expect(nacional.detalhe).toMatch(/^cotação real na hora · .+/);
  });

  it("erro ao ler as transportadoras: 'Conexão a confirmar', neutro (não finge saber)", () => {
    const [, nacional] = statusDaEntrega(
      entrada({ credsErro: true, nomesLigados: ["Melhor Envio"] }),
    );
    expect(nacional.valor).toBe("Conexão a confirmar");
    expect(nacional.tom).toBe("neutro");
  });

  it("cobertura local vence o erro de leitura", () => {
    const [, nacional] = statusDaEntrega(
      entrada({
        credsErro: true,
        config: config({ shippingCoverage: "local" }),
      }),
    );
    expect(nacional.valor).toBe("Só na sua cidade");
  });
});

describe("statusDaEntrega — Frete grátis local", () => {
  it("desligado: neutro", () => {
    const [, , gratis] = statusDaEntrega(entrada());
    expect(gratis.rotulo).toBe("Frete grátis local");
    expect(gratis.valor).toBe("Desligado");
    expect(gratis.tom).toBe("neutro");
  });

  it("acima de um valor: mostra o mínimo", () => {
    const [, , gratis] = statusDaEntrega(
      entrada({ config: config({ freeShippingMin: 150 }) }),
    );
    expect(gratis.valor).toBe("Acima de R$ 150");
    expect(gratis.tom).toBe("positivo");
  });

  it("em toda a loja (sentinela 0,01) e por produto (sentinela -1)", () => {
    expect(
      statusDaEntrega(entrada({ config: config({ freeShippingMin: 0.01 }) }))[2]
        .valor,
    ).toBe("Em toda a loja");
    expect(
      statusDaEntrega(entrada({ config: config({ freeShippingMin: -1 }) }))[2]
        .valor,
    ).toBe("Por produto marcado");
  });
});

describe("status da entrega em Só retiro", () => {
  it("não promete entrega ou transportadora e informa retirada para quem é de fora", () => {
    const [local, nacional, gratis] = statusDaEntrega(
      entrada({
        config: config({
          localDeliveryEnabled: false,
          enabledShippingMethods: ["store-pickup"],
          storeAddress: "Rua de Teste, 10",
        }),
        nomesLigados: ["Melhor Envio"],
      }),
    );
    expect(local.valor).toBe("Só retiro");
    expect(local.tom).toBe("positivo");
    expect(nacional.detalhe).toContain("retirar na loja");
    expect(gratis.valor).toBe("Retirada grátis");
  });
  it("sem endereço, avisa a pendência", () => {
    const [local] = statusDaEntrega(
      entrada({
        config: config({
          localDeliveryEnabled: false,
          enabledShippingMethods: ["store-pickup"],
        }),
      }),
    );
    expect(local.tom).toBe("atencao");
    expect(local.detalhe).toContain("endereço");
  });
  it("padrões explícitos preservam todos os resumos antigos", () => {
    expect(
      statusDaEntrega(
        entrada({
          config: config({ localDeliveryEnabled: true }),
        }),
      ),
    ).toEqual(statusDaEntrega(entrada()));
  });
});
