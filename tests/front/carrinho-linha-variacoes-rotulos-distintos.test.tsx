// @vitest-environment jsdom
//
// Auditoria de acessibilidade (06/11/2026): a mesma camiseta no carrinho em
// duas variações (Azul P e Azul M) dava dois botões "Remover Camiseta" e dois
// grupos "Quantidade de Camiseta" idênticos para o leitor de tela. Agora o
// rótulo da linha leva a variação.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function camiseta(): Product {
  return {
    id: "prod-camiseta",
    name: "Camiseta",
    description: "",
    price: 50,
    images: [],
    category: "Roupas",
    stock: 9,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(cart: CartItem[]) {
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
}

const rotulos = (seletor: string) =>
  [...hospedeiro.querySelectorAll(seletor)].map((el) =>
    el.getAttribute("aria-label"),
  );

describe("CartItemsList: rótulos únicos por linha", () => {
  it("identifica os dois preços só para leitor de tela quando há promoção", async () => {
    await montar([
      { product: { ...camiseta(), originalPrice: 70 }, quantity: 1 },
    ]);
    const original = hospedeiro.querySelector(".line-through")!;
    expect(original.querySelector(".sr-only")?.textContent).toBe(
      "Preço original: ",
    );
    expect(original.textContent?.replace(/\u00A0/g, " ")).toBe(
      "Preço original: R$ 70,00",
    );
    const atual = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Preço com desconto: "),
    )!;
    expect(atual.querySelector(".sr-only")?.textContent).toBe(
      "Preço com desconto: ",
    );
    expect(atual.textContent?.replace(/\u00A0/g, " ")).toBe(
      "Preço com desconto: R$ 50,00",
    );
  });

  it("sem promoção não anuncia preço original nem desconto", async () => {
    await montar([{ product: camiseta(), quantity: 1 }]);
    expect(hospedeiro.textContent).not.toContain("Preço original");
    expect(hospedeiro.textContent).not.toContain("Preço com desconto");
    expect(hospedeiro.querySelector(".line-through")).toBeNull();
    expect(hospedeiro.textContent?.replace(/\u00A0/g, " ")).toContain(
      "R$ 50,00",
    );
  });

  it("duas variações do mesmo produto têm 'Remover' e 'Quantidade de' distintos", async () => {
    await montar([
      {
        product: camiseta(),
        quantity: 1,
        variantId: "v-azul-p",
        variantNames: "Cor: Azul, Tamanho: P",
      },
      {
        product: camiseta(),
        quantity: 2,
        variantId: "v-azul-m",
        variantNames: "Cor: Azul, Tamanho: M",
      },
    ]);
    expect(rotulos('button[aria-label^="Remover "]')).toEqual([
      "Remover Camiseta (Cor: Azul, Tamanho: P)",
      "Remover Camiseta (Cor: Azul, Tamanho: M)",
    ]);
    expect(rotulos('[role="group"][aria-label^="Quantidade"]')).toEqual([
      "Quantidade de Camiseta (Cor: Azul, Tamanho: P)",
      "Quantidade de Camiseta (Cor: Azul, Tamanho: M)",
    ]);
  });

  it("sem variação o rótulo continua só com o nome do produto", async () => {
    await montar([{ product: camiseta(), quantity: 1 }]);
    expect(rotulos('button[aria-label^="Remover "]')).toEqual([
      "Remover Camiseta",
    ]);
    expect(rotulos('[role="group"][aria-label^="Quantidade"]')).toEqual([
      "Quantidade de Camiseta",
    ]);
  });
});
