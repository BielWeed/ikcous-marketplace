// @vitest-environment jsdom
//
// Issue #202 (ADMIN-091): o interruptor "Avaliações dos Clientes" já
// escondia a nota na página do produto (#101), mas o ProductCard -- usado em
// toda grade de produtos da loja -- continuava chamando `<StarRating
// rating={product.rating || 5} />` incondicionalmente. Este arquivo prova os
// dois estados do novo prop `showRating`, que o chamador (ProductList,
// SearchView, FavoritesView, ProductCarousel) passa a partir de
// `config.enableReviews` -- o ProductCard em si não lê o StoreContext, para
// não assinar o contexto inteiro em cada card de uma grade grande (ver nota
// no relatório da tarefa).
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de checkout-view-flag-off.test.tsx -- o que este teste
// prova é a ÁRVORE renderizada mudando (ou não) com o prop.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProductCard } from "@/components/ui/custom/ProductCard";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão de
// checkout-view-flag-off.test.tsx: sem ela o React reclama "not configured to
// support act(...)" em todo render, mesmo dentro de act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-202",
  name: "Produto Avaliado",
  description: "Descrição de teste",
  price: 100,
  images: ["https://example.com/img.png"],
  category: "geral",
  stock: 10,
  sold: 3,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 4.5,
  reviewCount: 12,
};

describe("ProductCard — prop showRating (ADMIN-091, #202)", () => {
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

  it("com showRating=false, nenhuma estrela é renderizada e o estoque continua visível", async () => {
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating={false}
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(0);
    expect(hospedeiro.textContent).not.toContain("(12)");
    expect(hospedeiro.textContent).toContain("Estoque: 10");
  });

  it("com showRating=true, as 5 estrelas continuam exatamente como hoje", async () => {
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(5);
    expect(hospedeiro.textContent).toContain("Estoque: 10");
  });
});
