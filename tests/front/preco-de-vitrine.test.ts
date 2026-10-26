// UI-191 (G3): a vitrine anunciava um preço que nenhuma opção à venda tinha.
// Caso real: produto 50 com "De" 70; variação P sem preço próprio e SEM
// estoque; variação G com preço próprio 90 e COM estoque. O card mostrava
// "De 70 · Por 50 · 29% OFF", a faixa de Ofertas dizia "Economize R$ 20" e,
// ao escolher G, o preço virava 90 (acima do "De").
// A regra: o preço de vitrine é o MENOR preço entre as opções ativas COM
// estoque; riscado, "% OFF" e economia só existem quando ele é menor que o "De".
import { describe, expect, it } from "vitest";

import { precoDeVitrine } from "@/lib/preco-de-vitrine";
import type { ProductVariant } from "@/types";

function v(
  id: string,
  extra: Partial<ProductVariant> & { name?: string } = {},
): ProductVariant {
  return {
    id,
    productId: "p1",
    name: "Tamanho",
    value: id,
    stockIncrement: 5,
    active: true,
    ...extra,
  };
}

describe("precoDeVitrine", () => {
  it("o caso do defeito: P sem estoque (preço do produto) e G com estoque a 90, 'De' 70 → mostra 90, sem desconto", () => {
    const r = precoDeVitrine({
      price: 50,
      originalPrice: 70,
      variants: [
        v("P", { stockIncrement: 0 }),
        v("G", { priceOverride: 90, stockIncrement: 4 }),
      ],
    });
    expect(r.preco).toBe(90);
    expect(r.aPartirDe).toBe(false);
    expect(r.precoOriginal).toBeNull();
    expect(r.desconto).toBe(0);
    expect(r.economia).toBe(0);
  });

  it("produto sem variação: o preço do produto, com desconto real quando o 'De' é maior", () => {
    const r = precoDeVitrine({ price: 50, originalPrice: 70 });
    expect(r).toEqual({
      preco: 50,
      aPartirDe: false,
      precoOriginal: 70,
      desconto: 29,
      economia: 20,
    });
  });

  it("produto sem variação e sem 'De', ou com 'De' igual/menor: nada de riscado", () => {
    expect(precoDeVitrine({ price: 50 }).precoOriginal).toBeNull();
    expect(precoDeVitrine({ price: 50, originalPrice: null }).desconto).toBe(0);
    expect(
      precoDeVitrine({ price: 50, originalPrice: 50 }).precoOriginal,
    ).toBeNull();
    expect(precoDeVitrine({ price: 50, originalPrice: 40 }).economia).toBe(0);
  });

  it("variação toda igual ao preço do produto: sem 'a partir de' e o desconto do produto vale", () => {
    const r = precoDeVitrine({
      price: 50,
      originalPrice: 70,
      variants: [v("P"), v("M"), v("G", { priceOverride: 50 })],
    });
    expect(r.preco).toBe(50);
    expect(r.aPartirDe).toBe(false);
    expect(r.desconto).toBe(29);
  });

  it("opções com preços diferentes: o MENOR, com 'a partir de'", () => {
    const r = precoDeVitrine({
      price: 50,
      variants: [v("P"), v("G", { priceOverride: 90 })],
    });
    expect(r.preco).toBe(50);
    expect(r.aPartirDe).toBe(true);
  });

  it("o menor preço está numa opção SEM estoque: ela não conta", () => {
    const r = precoDeVitrine({
      price: 50,
      variants: [
        v("P", { priceOverride: 30, stockIncrement: 0 }),
        v("M", { priceOverride: 60 }),
        v("G", { priceOverride: 80 }),
      ],
    });
    expect(r.preco).toBe(60);
    expect(r.aPartirDe).toBe(true);
  });

  it("opção inativa não conta, nem com estoque", () => {
    const r = precoDeVitrine({
      price: 50,
      originalPrice: 70,
      variants: [
        v("P", { priceOverride: 10, active: false }),
        v("G", { priceOverride: 90 }),
      ],
    });
    expect(r.preco).toBe(90);
    expect(r.precoOriginal).toBeNull();
  });

  it("preço próprio ZERO é um preço de verdade (brinde), não 'sem preço'", () => {
    const r = precoDeVitrine({
      price: 50,
      originalPrice: 70,
      variants: [v("P", { priceOverride: 0 }), v("G")],
    });
    expect(r.preco).toBe(0);
    expect(r.aPartirDe).toBe(true);
    expect(r.desconto).toBe(100);
  });

  it("todas as opções sem estoque: cai no menor preço entre as ativas, para o card não ficar sem preço", () => {
    const r = precoDeVitrine({
      price: 50,
      originalPrice: 70,
      variants: [
        v("P", { stockIncrement: 0 }),
        v("G", { priceOverride: 90, stockIncrement: 0 }),
      ],
    });
    expect(r.preco).toBe(50);
    expect(r.aPartirDe).toBe(true);
    expect(r.desconto).toBe(29);
  });

  it("produto com variações cadastradas mas nenhuma ativa: o preço do produto", () => {
    const r = precoDeVitrine({
      price: 50,
      originalPrice: 70,
      variants: [v("P", { active: false })],
    });
    expect(r.preco).toBe(50);
    expect(r.aPartirDe).toBe(false);
    expect(r.desconto).toBe(29);
  });

  describe("cadastro antigo com dois grupos (Cor e Tamanho)", () => {
    it("o preço é o da escolha PRINCIPAL (o grupo de nome menor): a Cor manda, o Tamanho não muda o valor", () => {
      const r = precoDeVitrine({
        price: 50,
        variants: [
          v("azul", { name: "Cor", priceOverride: 40 }),
          v("verde", { name: "Cor", priceOverride: 70 }),
          v("P", { name: "Tamanho", priceOverride: 5 }),
          v("G", { name: "Tamanho" }),
        ],
      });
      expect(r.preco).toBe(40);
      expect(r.aPartirDe).toBe(true);
    });

    it("um grupo sem nenhuma opção com estoque: nada se compra, cai no menor preço das ativas", () => {
      const r = precoDeVitrine({
        price: 50,
        variants: [
          v("azul", { name: "Cor", priceOverride: 40 }),
          v("P", { name: "Tamanho", stockIncrement: 0 }),
        ],
      });
      expect(r.preco).toBe(40);
    });
  });
});
