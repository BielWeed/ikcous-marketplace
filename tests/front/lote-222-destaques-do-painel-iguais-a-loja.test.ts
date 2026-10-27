import { precoDeVitrine } from "@/lib/preco-de-vitrine";
// Lote 222 (M1): o painel de Destaques usa as MESMAS regras da loja
// (HomeView): só produto ativo; esgotado no fim em Ofertas e Destaques em
// Alta; "oferta" pelo menor preço entre as opções à venda.
import {
  destaquesDaVitrine,
  ofertasDaVitrine,
  produtosAVenda,
} from "@/lib/vitrine";
import type { Product } from "@/types";
import { describe, expect, it } from "vitest";

function prod(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name: id,
    price: 100,
    stock: 5,
    isActive: true,
    isBestseller: false,
    variants: [],
    ...extra,
  } as unknown as Product;
}

// A regra escrita como a HomeView a escreve (HomeView.tsx ~207 e ~258-307).
function ofertasDaLoja(products: Product[]) {
  return products
    .filter((p) => p.isActive)
    .filter((p) => precoDeVitrine(p).precoOriginal !== null)
    .sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0));
}
function destaquesDaLoja(products: Product[]) {
  return products
    .filter((p) => p.isActive)
    .filter((p) => p.isBestseller)
    .sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0));
}

const catalogo = [
  prod("pausado-em-oferta", { isActive: false, originalPrice: 150 }),
  prod("esgotado-em-oferta", { stock: 0, originalPrice: 150 }),
  prod("oferta-normal", { originalPrice: 150 }),
  prod("opcao-em-promocao", {
    price: 100,
    originalPrice: 80, // base sem "De" válido, mas a opção à venda custa 60
    variants: [
      {
        id: "v",
        name: "Cor",
        value: "Azul",
        active: true,
        stockIncrement: 3,
        priceOverride: 60,
      },
    ] as unknown as Product["variants"],
  }),
  prod("pausado-destaque", { isActive: false, isBestseller: true }),
  prod("esgotado-destaque", { stock: 0, isBestseller: true }),
  prod("destaque-normal", { isBestseller: true }),
];

describe("lote 222 — Destaques do painel == loja", () => {
  it("produto pausado não entra na lista de produtos à venda", () => {
    expect(produtosAVenda(catalogo).map((p) => p.id)).not.toContain(
      "pausado-em-oferta",
    );
  });

  it("Ofertas: ativo, esgotado no fim, oferta pelo preço de vitrine", () => {
    const painel = ofertasDaVitrine(produtosAVenda(catalogo)).map((p) => p.id);
    expect(painel).toEqual(ofertasDaLoja(catalogo).map((p) => p.id));
    expect(painel).not.toContain("pausado-em-oferta");
    expect(painel).toContain("opcao-em-promocao");
    expect(painel[painel.length - 1]).toBe("esgotado-em-oferta");
  });

  it("Destaques em Alta: ativo e esgotado no fim", () => {
    const painel = destaquesDaVitrine(produtosAVenda(catalogo)).map(
      (p) => p.id,
    );
    expect(painel).toEqual(destaquesDaLoja(catalogo).map((p) => p.id));
    expect(painel).toEqual(["destaque-normal", "esgotado-destaque"]);
  });
});
