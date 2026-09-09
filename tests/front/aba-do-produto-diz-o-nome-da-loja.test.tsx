// @vitest-environment jsdom
// Montagem real no molde de product-view-estoque-contraste-aa.test.tsx.
// O hook useDocumentMeta permanece real: a prova lê o título da aba no DOM.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { branding } from "@/config/branding";
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

describe("ProductView — a aba do produto diz o nome da loja (#493)", () => {
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

  it("usa o nome configurado na loja no título da aba", async () => {
    mockConfig = { storeName: "LOJA DA PROVA 493" };
    await renderizarProduto();
    expect(document.title).toBe("Produto da Prova 493 | LOJA DA PROVA 493");
  });

  it.each(["", undefined, "   "])(
    "usa branding.appName quando storeName é %s",
    async (storeName) => {
      mockConfig = { storeName };
      await renderizarProduto();
      expect(document.title).toBe(`Produto da Prova 493 | ${branding.appName}`);
    },
  );

  it("remove espaços nas bordas do nome configurado", async () => {
    mockConfig = { storeName: "  LOJA DA PROVA 493  " };
    await renderizarProduto();
    expect(document.title).toBe("Produto da Prova 493 | LOJA DA PROVA 493");
  });

  it("preserva a prioridade do metaTitle preenchido", async () => {
    mockConfig = { storeName: "LOJA DA PROVA 493" };
    await renderizarProduto({
      ...produto,
      metaTitle: "Título especial do produto",
    });
    expect(document.title).toBe("Título especial do produto");
  });
});
