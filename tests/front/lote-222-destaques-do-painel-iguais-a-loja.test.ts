import { precoDeVitrine } from "@/lib/preco-de-vitrine";
// Lote 222 (M1): o painel de Destaques usa as MESMAS regras da loja
// (HomeView): só produto ativo; esgotado e sem foto real fora de Ofertas e
// Destaques em Alta (faixas automáticas só mostram o que se compra e tem foto);
// "oferta" pelo menor preço entre as opções à venda.
import {
  destaquesDaVitrine,
  ofertasDaVitrine,
  produtosAVenda,
} from "@/lib/vitrine-do-painel";
import type { Product } from "@/types";
import { describe, expect, it } from "vitest";

function prod(id: string, extra: Partial<Product> = {}): Product {
  return {
    id,
    name: id,
    price: 100,
    stock: 5,
    images: ["https://cdn.exemplo/foto.jpg"],
    isActive: true,
    isBestseller: false,
    variants: [],
    ...extra,
  } as unknown as Product;
}

// A regra escrita por extenso, sem as funções do app: ativo, à venda (estoque)
// e com foto real.
const vende = (p: Product) => p.stock > 0 && p.images.length > 0;
function ofertasDaLoja(products: Product[]) {
  return products
    .filter((p) => p.isActive)
    .filter((p) => precoDeVitrine(p).precoOriginal !== null)
    .filter(vende);
}
function destaquesDaLoja(products: Product[]) {
  return products
    .filter((p) => p.isActive)
    .filter((p) => p.isBestseller)
    .filter(vende);
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

  it("Ofertas: ativo, à venda, oferta pelo preço de vitrine", () => {
    const painel = ofertasDaVitrine(produtosAVenda(catalogo)).map((p) => p.id);
    expect(painel).toEqual(ofertasDaLoja(catalogo).map((p) => p.id));
    expect(painel).not.toContain("pausado-em-oferta");
    expect(painel).toContain("opcao-em-promocao");
    expect(painel).not.toContain("esgotado-em-oferta");
  });

  it("Destaques em Alta: ativo e à venda", () => {
    const painel = destaquesDaVitrine(produtosAVenda(catalogo)).map(
      (p) => p.id,
    );
    expect(painel).toEqual(destaquesDaLoja(catalogo).map((p) => p.id));
    expect(painel).toEqual(["destaque-normal"]);
  });
});
