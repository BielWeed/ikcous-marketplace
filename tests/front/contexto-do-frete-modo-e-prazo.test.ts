// O CARIMBO DO CACHE DE FRETE × "COMO ENTREGO NA MINHA CIDADE" (16/10/2026).
//
// A ShippingCalculator carimba o cache do navegador com
// `contextoDaLojaParaFrete(config)` e recota quando o carimbo muda. O modo
// (entrega própria ligada/desligada) e o prazo mudam o que a edge responde
// — sem entrarem no carimbo, a cliente veria por até 2 h a "Entrega Local"
// que a loja desligou, ou o prazo de ontem.
//
// A outra metade da regra é igualmente dura: com os PADRÕES (entrega ligada,
// 1 dia — e é isso que toda loja é até a lojista mexer), o carimbo tem de
// ser BYTE A BYTE o de antes. Senão o deploy invalida o cache de toda
// cliente de toda loja de uma vez, sem ninguém ter mudado nada.
import {
  VERSAO_DO_CONTRATO_DE_COTACAO,
  contextoDaLojaParaFrete,
} from "@/contexts/ContextoDoFreteDaLoja";
import { describe, expect, it } from "vitest";

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";

const COM_RETIRADA = {
  shippingProvider: "melhor_envio" as const,
  enabledShippingMethods: ["sedex", "pac", "store-pickup"],
  storeAddress: ENDERECO_FICTICIO,
};

describe("carimbo com os PADRÕES = o de antes, byte a byte", () => {
  // Capturados do código ANTERIOR a esta mudança (rodando a função velha),
  // não calculados pela função nova.
  const OURO: [
    string,
    Parameters<typeof contextoDaLojaParaFrete>[0],
    string,
  ][] = [
    ["sem config", undefined, '["",["pac","sedex"],false,"","cotacao-3"]'],
    ["config nula", null, '["",["pac","sedex"],false,"","cotacao-3"]'],
    [
      "melhor envio + retirada + endereço com espaços",
      {
        shippingProvider: "melhor_envio",
        enabledShippingMethods: ["sedex", "pac", "store-pickup"],
        storeAddress: "  Rua Ficticia, 1  ",
      },
      '["melhor_envio",["pac","sedex"],true,"Rua Ficticia, 1","cotacao-3"]',
    ],
    [
      "flat_fee só com a chave da retirada",
      {
        shippingProvider: "flat_fee",
        enabledShippingMethods: ["store-pickup"],
        storeAddress: undefined,
      },
      '["flat_fee",[],true,"","cotacao-3"]',
    ],
    [
      "frenet com lista nula",
      {
        shippingProvider: "frenet",
        enabledShippingMethods: undefined,
        storeAddress: null,
      },
      '["frenet",["pac","sedex"],false,"","cotacao-3"]',
    ],
  ];

  it.each(OURO)("%s", (_nome, config, esperado) => {
    expect(contextoDaLojaParaFrete(config)).toBe(esperado);
  });

  it("os padrões ditos EXPLICITAMENTE (true e 1) dão o mesmo carimbo de antes", () => {
    const antes = contextoDaLojaParaFrete(COM_RETIRADA);
    expect(
      contextoDaLojaParaFrete({
        ...COM_RETIRADA,
        localDeliveryEnabled: true,
        localDeliveryDays: 1,
      }),
    ).toBe(antes);
    expect(
      contextoDaLojaParaFrete({ ...COM_RETIRADA, localDeliveryEnabled: true }),
    ).toBe(antes);
    expect(
      contextoDaLojaParaFrete({ ...COM_RETIRADA, localDeliveryDays: 1 }),
    ).toBe(antes);
  });

  it("lixo nos campos novos (prazo inválido, coluna nula) lê como o padrão: carimbo de antes", () => {
    const antes = contextoDaLojaParaFrete(COM_RETIRADA);
    for (const days of [null, undefined, Number.NaN, -3, 31, 2.5]) {
      expect(
        contextoDaLojaParaFrete({
          ...COM_RETIRADA,
          localDeliveryDays: days as unknown as number,
        }),
      ).toBe(antes);
    }
    expect(
      contextoDaLojaParaFrete({
        ...COM_RETIRADA,
        localDeliveryEnabled: null as unknown as boolean,
      }),
    ).toBe(antes);
  });

  it("o carimbo continua terminando na versão do contrato (nada entra antes dela)", () => {
    expect(JSON.parse(contextoDaLojaParaFrete(COM_RETIRADA)).at(-1)).toBe(
      VERSAO_DO_CONTRATO_DE_COTACAO,
    );
  });
});

describe("carimbo MUDA quando o modo ou o prazo mudam", () => {
  const padrao = contextoDaLojaParaFrete(COM_RETIRADA);

  it("entrega própria desligada (só retiro) é outro carimbo", () => {
    expect(
      contextoDaLojaParaFrete({ ...COM_RETIRADA, localDeliveryEnabled: false }),
    ).not.toBe(padrao);
  });

  it.each([0, 2, 3, 7, 30])("prazo de %s dia(s) é outro carimbo", (dias) => {
    expect(
      contextoDaLojaParaFrete({ ...COM_RETIRADA, localDeliveryDays: dias }),
    ).not.toBe(padrao);
  });

  it("prazos diferentes entre si dão carimbos diferentes", () => {
    const vistos = new Set(
      [0, 2, 3, 7, 30].map((localDeliveryDays) =>
        contextoDaLojaParaFrete({ ...COM_RETIRADA, localDeliveryDays }),
      ),
    );
    expect(vistos.size).toBe(5);
  });

  it("os três modos dão três carimbos diferentes (entrego / entrego e retiro / só retiro)", () => {
    const entrego = contextoDaLojaParaFrete({
      ...COM_RETIRADA,
      enabledShippingMethods: ["sedex", "pac"],
      localDeliveryEnabled: true,
    });
    const entregoERetiro = contextoDaLojaParaFrete({
      ...COM_RETIRADA,
      localDeliveryEnabled: true,
    });
    const soRetiro = contextoDaLojaParaFrete({
      ...COM_RETIRADA,
      localDeliveryEnabled: false,
    });
    expect(new Set([entrego, entregoERetiro, soRetiro]).size).toBe(3);
  });

  it("só retiro com prazo diferente também difere (prazo guardado mesmo com a entrega desligada não confunde)", () => {
    const a = contextoDaLojaParaFrete({
      ...COM_RETIRADA,
      localDeliveryEnabled: false,
      localDeliveryDays: 1,
    });
    const b = contextoDaLojaParaFrete({
      ...COM_RETIRADA,
      localDeliveryEnabled: false,
      localDeliveryDays: 5,
    });
    expect(a).not.toBe(b);
  });
});
