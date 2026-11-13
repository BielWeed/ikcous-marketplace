// O CARIMBO DO CACHE DE FRETE × A TAXA DA ENTREGA PRÓPRIA (12/11/2026).
//
// Defeito medido: a lojista muda a taxa da entrega própria de R$ 10 para
// R$ 20, a cliente com o carrinho aberto continua vendo R$ 10 — o preço da
// "Entrega Local" vem da edge, e a edge só é chamada de novo quando o
// carimbo (`contextoDaLojaParaFrete`) muda. A taxa não estava nele.
//
// As duas metades da regra, como nas notas do carimbo:
//   1. taxa DIFERENTE da padrão (R$ 10, a mesma que a edge assume quando a
//      coluna é nula) com a entrega própria LIGADA muda o carimbo;
//   2. tudo o que já valia continua BYTE A BYTE igual: entrega desligada
//      (a taxa não é cobrada), taxa ausente, inválida ou igual à padrão.
//      Os textos abaixo foram escritos à mão a partir do carimbo de antes.
import { contextoDaLojaParaFrete } from "@/contexts/ContextoDoFreteDaLoja";
import { describe, expect, it } from "vitest";

const BASE = {
  shippingProvider: "melhor_envio" as const,
  enabledShippingMethods: ["sedex", "pac", "store-pickup"],
  storeAddress: "Rua Ficticia, 1",
};

// O carimbo de ANTES desta mudança para a BASE (entrega ligada, 1 dia).
const OURO_PADRAO =
  '["melhor_envio",["pac","sedex"],true,"Rua Ficticia, 1","cotacao-3"]';
// O de antes com a entrega própria desligada ("só retiro").
const OURO_SO_RETIRO =
  '["melhor_envio",["pac","sedex"],true,"Rua Ficticia, 1","cotacao-3",["entrega-propria",false,1]]';
// O de antes com a entrega ligada e prazo de 3 dias.
const OURO_TRES_DIAS =
  '["melhor_envio",["pac","sedex"],true,"Rua Ficticia, 1","cotacao-3",["entrega-propria",true,3]]';

describe("a taxa da entrega própria entra no carimbo quando foge do padrão", () => {
  it("taxa de R$ 10 e de R$ 20 dão carimbos DIFERENTES (o caso da lojista)", () => {
    const dez = contextoDaLojaParaFrete({ ...BASE, localDeliveryFee: 10 });
    const vinte = contextoDaLojaParaFrete({ ...BASE, localDeliveryFee: 20 });
    expect(vinte).not.toBe(dez);
  });

  it("taxas diferentes entre si dão carimbos diferentes, inclusive R$ 0 (entrega grátis é taxa de verdade)", () => {
    const vistos = new Set(
      [0, 5, 10, 12.5, 20, 25].map((localDeliveryFee) =>
        contextoDaLojaParaFrete({ ...BASE, localDeliveryFee }),
      ),
    );
    expect(vistos.size).toBe(6);
  });

  it("o texto da taxa fora do padrão é o de antes MAIS um trecho no fim", () => {
    expect(contextoDaLojaParaFrete({ ...BASE, localDeliveryFee: 20 })).toBe(
      '["melhor_envio",["pac","sedex"],true,"Rua Ficticia, 1","cotacao-3",["taxa-da-entrega-propria",20]]',
    );
    expect(contextoDaLojaParaFrete({ ...BASE, localDeliveryFee: 0 })).toBe(
      '["melhor_envio",["pac","sedex"],true,"Rua Ficticia, 1","cotacao-3",["taxa-da-entrega-propria",0]]',
    );
  });

  it("taxa que chega como texto numérico do banco vale o mesmo que o número", () => {
    expect(
      contextoDaLojaParaFrete({
        ...BASE,
        localDeliveryFee: "20.00" as unknown as number,
      }),
    ).toBe(contextoDaLojaParaFrete({ ...BASE, localDeliveryFee: 20 }));
    expect(
      contextoDaLojaParaFrete({
        ...BASE,
        localDeliveryFee: "10" as unknown as number,
      }),
    ).toBe(OURO_PADRAO);
  });

  it("com prazo fora do padrão, os dois trechos convivem e o do prazo continua onde estava", () => {
    expect(
      contextoDaLojaParaFrete({
        ...BASE,
        localDeliveryDays: 3,
        localDeliveryFee: 20,
      }),
    ).toBe(
      '["melhor_envio",["pac","sedex"],true,"Rua Ficticia, 1","cotacao-3",["entrega-propria",true,3],["taxa-da-entrega-propria",20]]',
    );
  });

  it("o carimbo continua tendo a versão do contrato NA MESMA posição (nada entra antes dela)", () => {
    const carimbo = JSON.parse(
      contextoDaLojaParaFrete({ ...BASE, localDeliveryFee: 20 }),
    );
    expect(carimbo[4]).toBe("cotacao-3");
  });
});

describe("tudo o que já valia continua byte a byte o mesmo", () => {
  it("taxa ausente, nula, inválida ou igual à padrão = o carimbo de antes", () => {
    const lixo: unknown[] = [
      undefined,
      null,
      10,
      "10",
      "10.0",
      "",
      "  ",
      "abc",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      {},
      true,
    ];
    for (const localDeliveryFee of lixo) {
      expect(
        contextoDaLojaParaFrete({
          ...BASE,
          localDeliveryFee: localDeliveryFee as number,
        }),
      ).toBe(OURO_PADRAO);
    }
    expect(contextoDaLojaParaFrete(BASE)).toBe(OURO_PADRAO);
  });

  it("entrega própria DESLIGADA: a taxa não importa — o carimbo é o de antes, qualquer que seja ela", () => {
    for (const localDeliveryFee of [undefined, 0, 10, 20, 99.9]) {
      expect(
        contextoDaLojaParaFrete({
          ...BASE,
          localDeliveryEnabled: false,
          localDeliveryFee,
        }),
      ).toBe(OURO_SO_RETIRO);
    }
  });

  it("prazo fora do padrão com taxa padrão ou ausente = o carimbo de antes", () => {
    for (const localDeliveryFee of [undefined, null, 10]) {
      expect(
        contextoDaLojaParaFrete({
          ...BASE,
          localDeliveryDays: 3,
          localDeliveryFee: localDeliveryFee as number,
        }),
      ).toBe(OURO_TRES_DIAS);
    }
  });

  it("sem config e config nula: o carimbo de antes", () => {
    const antes = '["",["pac","sedex"],false,"","cotacao-3"]';
    expect(contextoDaLojaParaFrete(undefined)).toBe(antes);
    expect(contextoDaLojaParaFrete(null)).toBe(antes);
  });
});
