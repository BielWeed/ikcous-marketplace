// Preço de vitrine (o que o card, as Ofertas e a ordenação por preço anunciam):
//  1. uma opção com UMA unidade em estoque está à venda (estoque 1 não é "esgotado");
//  2. o preço é o da variação PRINCIPAL — o grupo de nome menor, qualquer que seja
//     a ordem em que as variações chegaram do banco.
import { describe, expect, it } from "vitest";

import { precoDeVitrine } from "@/lib/preco-de-vitrine";

const variacao = (
  name: string,
  estoque: number,
  priceOverride?: number,
  active = true,
) => ({ name, active, stockIncrement: estoque, priceOverride });

describe("precoDeVitrine: opção com 1 unidade está à venda", () => {
  it("tamanho G com 1 unidade vende a 60; o P esgotado a 30 não conta", () => {
    const vitrine = precoDeVitrine({
      price: 50,
      variants: [variacao("Tamanho", 0, 30), variacao("Tamanho", 1, 60)],
    });

    expect(vitrine.preco).toBe(60);
    expect(vitrine.aPartirDe).toBe(false);
  });

  it("produto com variação única de 1 unidade usa o preço dela", () => {
    const vitrine = precoDeVitrine({
      price: 100,
      originalPrice: 150,
      variants: [variacao("Tamanho", 1, 90)],
    });

    expect(vitrine.preco).toBe(90);
    expect(vitrine.precoOriginal).toBe(150);
    expect(vitrine.economia).toBe(60);
  });

  it("todas esgotadas: o card ainda mostra o menor preço entre as opções ativas", () => {
    const vitrine = precoDeVitrine({
      price: 50,
      variants: [variacao("Tamanho", 0, 30), variacao("Tamanho", 0, 60)],
    });

    expect(vitrine.preco).toBe(30);
    expect(vitrine.aPartirDe).toBe(true);
  });
});

describe("precoDeVitrine: o grupo principal é o de nome menor, em qualquer ordem", () => {
  const cor = variacao("Cor", 5, 120);
  const material = variacao("Material", 5, 100);
  const tamanho = variacao("Tamanho", 5, 80);

  it.each([
    ["Tamanho, Material, Cor", [tamanho, material, cor]],
    ["Cor, Material, Tamanho", [cor, material, tamanho]],
    ["Material, Tamanho, Cor", [material, tamanho, cor]],
    ["Tamanho, Cor", [tamanho, cor]],
  ])(
    "variações chegando como %s: o preço é o da Cor (120)",
    (_ordem, variants) => {
      const vitrine = precoDeVitrine({ price: 100, variants });

      expect(vitrine.preco).toBe(120);
      expect(vitrine.aPartirDe).toBe(false);
    },
  );
});
