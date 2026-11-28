// CHAVE DA COMPRA — o valor dos itens entra na impressão em CENTAVOS
// ARREDONDADOS (lote 591, caça de mutantes 28/11/2026).
//
// `centavos()` em `src/lib/chave-do-pedido.ts` faz `Math.round(valor * 100)`.
// Trocar por `Math.floor` ou tirar o arredondamento não derrubava teste algum:
// os vizinhos usam valores (120, 20, 23,5, 20,1) que, multiplicados por 100,
// caem exatos ou com ruído para CIMA. O ruído para BAIXO é o que morde:
// 19,99 × 100 = 1998,9999…, e 99,77 × 100 = 9977,000…2 enquanto 9,87 × 100
// = 987,000…1. Truncar esse ruído muda a impressão quando só o frete mudou —
// a chave gira e a retentativa com frete recotado cria um SEGUNDO pedido.
//
// A impressão é `versão~itens~valorDosItensEmCentavos~…`: o terceiro campo é
// o centavo que se confere aqui.
import { describe, expect, it } from "vitest";

import {
  type CompraParaImpressao,
  impressaoDaCompra,
} from "@/lib/chave-do-pedido";

function compra(
  valorDosItens: number,
  frete: number,
  quantidade = 1,
): CompraParaImpressao {
  return {
    items: [
      { product_id: "prod-teste", variant_id: null, quantity: quantidade },
    ],
    totalAmount: valorDosItens + frete,
    shippingCost: frete,
    destinationCep: "38500000",
    shippingOptionId: "1",
    couponCode: null,
    addressId: "end-1",
    cepDoEndereco: null,
    paymentMethod: "online",
  };
}

function valorNaImpressao(c: CompraParaImpressao): string | undefined {
  return impressaoDaCompra(c).split("~")[2];
}

describe("impressaoDaCompra — o centavo dos itens é arredondado, não truncado", () => {
  it("item de R$ 89,90 com frete 9,87 ou 12,30: mesma impressão (só o frete mudou)", () => {
    const freteA = compra(89.9, 9.87);
    const freteB = compra(89.9, 12.3);
    expect(valorNaImpressao(freteA)).toBe("8990");
    expect(valorNaImpressao(freteB)).toBe("8990");
    expect(impressaoDaCompra(freteA)).toBe(impressaoDaCompra(freteB));
  });

  it("total 35,70 com frete 15,70: o valor dos itens é 2000 centavos exatos", () => {
    const c: CompraParaImpressao = {
      ...compra(20, 15.7),
      totalAmount: 35.7,
    };
    expect(valorNaImpressao(c)).toBe("2000");
    expect(impressaoDaCompra(c)).toBe(impressaoDaCompra(compra(20, 0)));
  });

  it("R$ 19,99 (19,99 × 100 = 1998,9999…) dá 1999 centavos, não 1998", () => {
    expect(valorNaImpressao(compra(19.99, 0))).toBe("1999");
  });

  it("19,99 × 3 com frete 9,87 dá 5997 centavos e repete a impressão sem frete", () => {
    const comFrete = compra(19.99 * 3, 9.87, 3);
    expect(valorNaImpressao(comFrete)).toBe("5997");
    expect(impressaoDaCompra(comFrete)).toBe(
      impressaoDaCompra(compra(19.99 * 3, 0, 3)),
    );
  });
});
