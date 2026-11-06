// @vitest-environment jsdom
//
// O carrinho mostrava SEMPRE a primeira foto do produto: duas linhas do mesmo
// produto em cores diferentes (Azul e Rosa) saíam com a mesma foto. Agora cada
// linha mostra a foto da cor escolhida (a página do produto e o card já faziam
// isso) e cai na foto do produto quando a cor não tem foto própria.
//
// Render de verdade (react-dom/client + jsdom), como carrinho-mostra-a-variacao-
// escolhida.test.tsx: o `src` da miniatura só se prova no que a tela desenha.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0, enableReviews: false },
  }),
}));

// URLs de fora do Storage: a miniatura devolve a própria URL (sem CDN), então
// o `src` do teste é exatamente a foto escolhida.
const FOTO_DO_PRODUTO = "https://fotos.test/camiseta.jpg";
const FOTO_AZUL = "https://fotos.test/camiseta-azul.jpg";
const FOTO_ROSA = "https://fotos.test/camiseta-rosa.jpg";

const camiseta: Product = {
  id: "prod-camiseta",
  name: "Camiseta Teste",
  description: "",
  price: 50,
  images: [FOTO_DO_PRODUTO],
  category: "Roupas",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
  variants: [
    {
      id: "var-azul",
      productId: "prod-camiseta",
      name: "Cor",
      value: "Azul",
      stockIncrement: 5,
      active: true,
      imageUrl: FOTO_AZUL,
    },
    {
      id: "var-rosa",
      productId: "prod-camiseta",
      name: "Cor",
      value: "Rosa",
      stockIncrement: 5,
      active: true,
      imageUrl: FOTO_ROSA,
    },
    {
      id: "var-verde",
      productId: "prod-camiseta",
      name: "Cor",
      value: "Verde",
      stockIncrement: 5,
      active: true,
    },
  ],
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartItemsList — a foto da linha é a da cor escolhida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarCarrinho(cart: CartItem[]) {
    const { CartItemsList } = await import(
      "@/components/ui/custom/CartItemsList"
    );
    await act(async () => {
      raiz.render(
        <CartItemsList
          cart={cart}
          removingId={null}
          onUpdateQuantity={() => {}}
          onRemove={() => {}}
          handleClearCart={() => {}}
        />,
      );
    });
    return [...hospedeiro.querySelectorAll("img")];
  }

  it("duas linhas do mesmo produto em cores diferentes mostram fotos diferentes", async () => {
    const fotos = await renderizarCarrinho([
      {
        product: camiseta,
        quantity: 1,
        variantId: "var-azul",
        variantNames: "Cor: Azul",
      },
      {
        product: camiseta,
        quantity: 2,
        variantId: "var-rosa",
        variantNames: "Cor: Rosa",
      },
    ]);
    expect(fotos.map((f) => f.getAttribute("src"))).toEqual([
      FOTO_AZUL,
      FOTO_ROSA,
    ]);
    // O texto alternativo descreve a foto que está na tela.
    expect(fotos.map((f) => f.getAttribute("alt"))).toEqual([
      "Camiseta Teste - Cor: Azul",
      "Camiseta Teste - Cor: Rosa",
    ]);
  });

  it("cor sem foto própria continua com a foto do produto", async () => {
    const fotos = await renderizarCarrinho([
      {
        product: camiseta,
        quantity: 1,
        variantId: "var-verde",
        variantNames: "Cor: Verde",
      },
    ]);
    expect(fotos[0].getAttribute("src")).toBe(FOTO_DO_PRODUTO);
  });

  it("linha sem variação continua com a foto do produto e o nome do produto no alt", async () => {
    const fotos = await renderizarCarrinho([
      { product: { ...camiseta, variants: [] }, quantity: 1 },
    ]);
    expect(fotos[0].getAttribute("src")).toBe(FOTO_DO_PRODUTO);
    expect(fotos[0].getAttribute("alt")).toBe("Camiseta Teste");
  });
});
