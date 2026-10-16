// FRETE GRÁTIS "ACIMA DE UM VALOR" CONTA EM CENTAVOS (16/10/2026).
//
// Dois preços normais somam errado em ponto flutuante: 10.10 + 10.20 =
// 20.299999999999997, que é `< 20.30`. Com meta de R$ 20,30 e entrega local de
// R$ 10, a tela cobrava R$ 10 de frete onde o servidor (que soma em `numeric`)
// zera — a divergência vira "frete desatualizado" no fechamento do pedido.
//
// Aqui: a regra pura `precoFinalDaOpcao`/`economiaDaOpcao`, que o CartContext
// e o ShippingCalculator alimentam com a soma crua dos itens.
import {
  type ContextoDoPrecoDeFrete,
  economiaDaOpcao,
  precoFinalDaOpcao,
} from "@/lib/estrategias-de-frete";
import { describe, expect, it } from "vitest";

const SOMA_QUE_ERRA = 10.1 + 10.2;

function ctx(subtotal: number, freeShippingMin = 20.3): ContextoDoPrecoDeFrete {
  return {
    config: { freeShippingMin },
    subtotal,
    temItemMarcado: false,
  };
}

const ENTREGA_LOCAL = { id: "local-delivery", price: 10 };
const TRANSPORTADORA_SEM_CARIMBO = { id: "melhor-envio-sedex", price: 25 };

describe("pré-condição: a soma de ponto flutuante de fato erra", () => {
  it("10.10 + 10.20 não é 20.30 em ponto flutuante", () => {
    expect(SOMA_QUE_ERRA).not.toBe(20.3);
    expect(SOMA_QUE_ERRA < 20.3).toBe(true);
  });
});

describe("precoFinalDaOpcao — meta por valor compara em centavos", () => {
  it("itens 10.10 + 10.20, meta 20.30, entrega local de R$ 10 -> frete grátis (0)", () => {
    expect(precoFinalDaOpcao(ENTREGA_LOCAL, ctx(SOMA_QUE_ERRA))).toBe(0);
  });

  it("valor exato (20.30 = 20.30) -> grátis", () => {
    expect(precoFinalDaOpcao(ENTREGA_LOCAL, ctx(20.3))).toBe(0);
  });

  it("CONTROLE: um centavo abaixo (20.29 contra 20.30) continua cobrando R$ 10", () => {
    expect(precoFinalDaOpcao(ENTREGA_LOCAL, ctx(20.29))).toBe(10);
  });

  it("CONTROLE: soma que erra para BAIXO mas é um centavo menor de verdade (10.10 + 10.19) cobra", () => {
    expect(precoFinalDaOpcao(ENTREGA_LOCAL, ctx(10.1 + 10.19))).toBe(10);
  });

  it("acima da meta -> grátis", () => {
    expect(precoFinalDaOpcao(ENTREGA_LOCAL, ctx(25))).toBe(0);
  });

  it("nacional SEM carimbo segue a mesma regra legada (o servidor faz igual)", () => {
    expect(
      precoFinalDaOpcao(TRANSPORTADORA_SEM_CARIMBO, ctx(SOMA_QUE_ERRA)),
    ).toBe(0);
    expect(precoFinalDaOpcao(TRANSPORTADORA_SEM_CARIMBO, ctx(20.29))).toBe(25);
  });

  it("nacional COM carimbo continua intocado (preço já é final)", () => {
    expect(
      precoFinalDaOpcao(
        {
          id: "melhor-envio-sedex",
          price: 25,
          estrategiaNacional: {
            estrategia: "acima_de_valor",
            minimo: 20.3,
            tipoDesconto: null,
            valorDesconto: 0,
            alcance: "todas",
          },
        },
        ctx(SOMA_QUE_ERRA),
      ),
    ).toBe(25);
  });
});

describe("economiaDaOpcao — a economia segue o mesmo veredito", () => {
  it("meta batida pela soma que erra: economizou os R$ 10 da taxa", () => {
    expect(economiaDaOpcao(ENTREGA_LOCAL, ctx(SOMA_QUE_ERRA))).toBe(10);
  });

  it("CONTROLE: um centavo abaixo não economiza nada", () => {
    expect(economiaDaOpcao(ENTREGA_LOCAL, ctx(20.29))).toBe(0);
  });
});
