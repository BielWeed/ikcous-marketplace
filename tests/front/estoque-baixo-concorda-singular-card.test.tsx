// @vitest-environment jsdom
//
// Defeito medido na vitrine da Savy: com 1 unidade sobrando o cartão do
// produto dizia "Apenas 1 restam!" (concordância errada). Tem de dizer
// "Resta apenas 1!" no singular e "Restam apenas N!" no plural.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProductCard } from "@/components/ui/custom/ProductCard";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produtoComEstoque(stock: number): Product {
  return {
    id: `prod-estoque-${stock}`,
    name: "Produto Estoque Baixo",
    description: "",
    price: 100,
    images: [],
    category: "geral",
    stock,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
}

describe("ProductCard — aviso de estoque baixo concorda em número", () => {
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

  async function montar(stock: number) {
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produtoComEstoque(stock)}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating={false}
        />,
      );
    });
  }

  it("1 unidade: 'Resta apenas 1!'", async () => {
    await montar(1);
    expect(hospedeiro.textContent).toContain("Resta apenas 1!");
    expect(hospedeiro.textContent).not.toContain("restam!");
  });

  it("3 unidades: 'Restam apenas 3!'", async () => {
    await montar(3);
    expect(hospedeiro.textContent).toContain("Restam apenas 3!");
    expect(hospedeiro.textContent).not.toContain("Apenas 3 restam!");
  });
});
