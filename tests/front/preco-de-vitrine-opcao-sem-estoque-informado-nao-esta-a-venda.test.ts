// `precoDeVitrine` roda também na borda (prévia do link) e lê opções cujo
// `stockIncrement` é OPCIONAL no contrato dela. Opção sem estoque informado
// (campo ausente) não está à venda: tratar a falta de informação como "tem
// estoque" anunciaria um preço que ninguém consegue comprar -- o mesmo defeito
// do UI-191 (G3), por outro caminho. Fronteira: estoque ausente == estoque 0.
import { describe, expect, it } from "vitest";

import { precoDeVitrine } from "@/lib/preco-de-vitrine";

describe("precoDeVitrine — opção sem estoque informado", () => {
  it("a opção barata SEM o campo de estoque não puxa o preço: vale a que tem estoque", () => {
    const r = precoDeVitrine({
      price: 50,
      originalPrice: 70,
      variants: [
        { name: "Tamanho", active: true, priceOverride: 30 },
        { name: "Tamanho", active: true, priceOverride: 60, stockIncrement: 4 },
      ],
    });

    expect(r.preco).toBe(60);
    expect(r.aPartirDe).toBe(false);
    // 60 < 70: o desconto é o do preço que se compra de verdade (R$ 10,00).
    expect(r.precoOriginal).toBe(70);
    expect(r.economia).toBe(10);
    expect(r.desconto).toBe(14);
  });

  it("um grupo inteiro sem o campo de estoque (Cor com estoque, Tamanho sem): nada se compra e o card cai no menor preço", () => {
    const r = precoDeVitrine({
      price: 50,
      variants: [
        { name: "Cor", active: true, priceOverride: 40, stockIncrement: 0 },
        { name: "Cor", active: true, priceOverride: 70, stockIncrement: 3 },
        { name: "Tamanho", active: true, priceOverride: 5 },
      ],
    });

    // Tamanho nunca informou estoque: não dá para levar nada. Com "ausente =
    // tem estoque" a regra acharia uma compra possível e anunciaria só os
    // R$ 70 da Cor com estoque, escondendo o "a partir de R$ 40".
    expect(r.preco).toBe(40);
    expect(r.aPartirDe).toBe(true);
  });
});
