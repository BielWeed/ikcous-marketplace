// Painel, lista de Produtos: o preço mostrado é o que a cliente PAGA, não o
// preço base do cadastro. Caso do defeito: base 69,90 e todo tamanho com preço
// próprio de 89,90 -- a lista dizia R$ 69,90 enquanto a loja cobrava 89,90.
//
// A regra não é nova: são os preços possíveis de uma compra pela mesma conta do
// servidor (`precosPossiveis`, `COALESCE(price_override, preco_venda)`), sobre as
// variações ATIVAS e sem olhar estoque (a lista mostra o preço até do esgotado).
// Zero é preço (brinde), não ausência: só null/undefined segue o produto.
import { describe, expect, it } from "vitest";

import { precoCobradoNaLista } from "@/lib/preco-cobrado-na-lista";

const tamanho = (
  value: string,
  priceOverride?: number,
  active = true,
  stockIncrement = 3,
) => ({ name: "Tamanho", value, active, stockIncrement, priceOverride });

describe("precoCobradoNaLista", () => {
  it("o caso do defeito: base 69,90 e todo tamanho a 89,90 → R$ 89,90", () => {
    expect(
      precoCobradoNaLista({
        price: 69.9,
        variants: [tamanho("P", 89.9), tamanho("M", 89.9), tamanho("G", 89.9)],
      }),
    ).toBe("R$ 89,90");
  });

  it("preços diferentes → faixa R$ menor – R$ maior", () => {
    expect(
      precoCobradoNaLista({
        price: 69.9,
        variants: [tamanho("P"), tamanho("M", 79.9), tamanho("G", 89.9)],
      }),
    ).toBe("R$ 69,90 – R$ 89,90");
  });

  it("variação sem preço próprio segue o produto: todas iguais ao base → um preço só", () => {
    expect(
      precoCobradoNaLista({
        price: 69.9,
        variants: [tamanho("P"), tamanho("G")],
      }),
    ).toBe("R$ 69,90");
  });

  it("variação INATIVA não entra na conta", () => {
    expect(
      precoCobradoNaLista({
        price: 69.9,
        variants: [tamanho("P", 89.9), tamanho("G", 150, false)],
      }),
    ).toBe("R$ 89,90");
  });

  it("todas inativas → o preço do produto", () => {
    expect(
      precoCobradoNaLista({
        price: 69.9,
        variants: [tamanho("P", 89.9, false)],
      }),
    ).toBe("R$ 69,90");
  });

  it("preço próprio ZERO é preço (o servidor cobra zero), não 'segue o produto'", () => {
    expect(
      precoCobradoNaLista({
        price: 69.9,
        variants: [tamanho("P", 0), tamanho("G")],
      }),
    ).toBe("R$ 0,00 – R$ 69,90");
  });

  it("esgotado não some da conta: a lista mostra o preço mesmo sem estoque", () => {
    expect(
      precoCobradoNaLista({
        price: 69.9,
        variants: [tamanho("P", 89.9, true, 0), tamanho("G", 99.9, true, 0)],
      }),
    ).toBe("R$ 89,90 – R$ 99,90");
  });

  it("sem variações → o preço base, como antes", () => {
    expect(precoCobradoNaLista({ price: 69.9 })).toBe("R$ 69,90");
    expect(precoCobradoNaLista({ price: 69.9, variants: [] })).toBe("R$ 69,90");
  });

  it("promoção: o 'De' (originalPrice) não aparece; vale o preço de venda", () => {
    expect(precoCobradoNaLista({ price: 69.9, originalPrice: 99.9 })).toBe(
      "R$ 69,90",
    );
    expect(
      precoCobradoNaLista({
        price: 69.9,
        originalPrice: 99.9,
        variants: [tamanho("P", 89.9)],
      }),
    ).toBe("R$ 89,90");
  });

  it("dois grupos (Cor e Tamanho): o preço é o do grupo principal, como o servidor cobra", () => {
    expect(
      precoCobradoNaLista({
        price: 50,
        variants: [
          {
            name: "Cor",
            active: true,
            stockIncrement: 2,
            priceOverride: 60,
          },
          {
            name: "Tamanho",
            active: true,
            stockIncrement: 2,
            priceOverride: 90,
          },
        ],
      }),
    ).toBe("R$ 60,00");
  });

  it("milhar no formato que a lista já usava (ponto de milhar, sem espaço inquebrável)", () => {
    expect(precoCobradoNaLista({ price: 1234567.89 })).toBe("R$ 1.234.567,89");
  });
});
