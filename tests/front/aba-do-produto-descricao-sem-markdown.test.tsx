// @vitest-environment jsdom
// Molde de aba-do-produto-diz-o-nome-da-loja.test.tsx. useDocumentMeta real:
// a prova lê a meta description no DOM.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, StoreConfig } from "@/types";

let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));

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

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "produto-prova-493",
  name: "Produto da Prova 493",
  description: "Descrição de teste",
  price: 100,
  images: ["https://example.com/produto.jpg"],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
};

describe("ProductView — a descrição da aba do navegador vem sem Markdown (r25-s)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let headAnterior: string;

  beforeEach(() => {
    mockConfig = {};
    headAnterior = document.head.innerHTML;
    document.title = "Título anterior à montagem";
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (valor: string) => valor });
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.head.innerHTML = headAnterior;
    vi.unstubAllGlobals();
  });

  async function renderizarProduto(product: Product = produto) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={product}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  const meta = () =>
    document.head
      .querySelector('meta[name="description"]')
      ?.getAttribute("content");

  it("a descrição da aba perde ** e # e junta as linhas", async () => {
    await renderizarProduto({
      ...produto,
      description: "**Caderno Inteligente**\n* 50 Páginas\n* Acompanha caneta",
    });
    expect(meta()).toBe("Caderno Inteligente 50 Páginas Acompanha caneta");
  });

  it("respeita o teto de 150 e o metaDescription preenchido segue com prioridade", async () => {
    await renderizarProduto({
      ...produto,
      description: "palavra ".repeat(60),
    });
    expect(Array.from(meta() ?? "").length).toBeLessThanOrEqual(150);
    expect(meta()?.endsWith("…")).toBe(true);
    await act(async () => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await renderizarProduto({
      ...produto,
      description: "**x**",
      metaDescription: "Texto do lojista",
    });
    expect(meta()).toBe("Texto do lojista");
  });
});
