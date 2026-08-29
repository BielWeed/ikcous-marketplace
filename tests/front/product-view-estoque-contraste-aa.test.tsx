// @vitest-environment jsdom
//
// Defeito: o rótulo de estoque saudável ("Em estoque: N") da página do
// produto usava `text-emerald-600`, que mede 3,58-3,77:1 contra o mínimo AA
// (4,5:1) de texto normal. `text-emerald-700` mede 5,21:1 e passa.
//
// Escopo: só o rótulo de texto (ProductView.tsx:893). NÃO é o ícone de frete
// (`Truck`, ProductView.tsx:937) nem o "dot" pulsante -- componente gráfico,
// WCAG 1.4.11 (mínimo 3:1), já passam, fora do escopo desta tarefa.
//
// Modelo estrutural copiado de product-view-gate-avaliacoes.test.tsx (mesmos
// dublês e stubs de jsdom).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
  }),
}));

// jsdom não implementa IntersectionObserver -- o efeito de recomendações do
// ProductView cria um a cada montagem.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoEmEstoque: Product = {
  id: "prod-view-contraste",
  name: "Produto Em Estoque",
  description: "Descrição de teste",
  price: 100,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};

describe("ProductView — rótulo 'Em estoque: N' usa text-emerald-700 (contraste AA), não mais text-emerald-600", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  it("estoque saudável (>3 unidades): o rótulo troca de tom", async () => {
    const { ProductView } = await import("@/views/customer/ProductView");

    await act(async () => {
      raiz.render(
        <ProductView
          product={produtoEmEstoque}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const rotulo = spans.find((el) => el.textContent === "Em estoque: 10");
    expect(rotulo).not.toBeUndefined();
    expect(rotulo?.classList.contains("text-emerald-700")).toBe(true);
    expect(rotulo?.classList.contains("text-emerald-600")).toBe(false);
  });
});
