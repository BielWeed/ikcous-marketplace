// @vitest-environment jsdom
//
// A pagina do produto prometia "Troca garantida em ate 24h apos entrega" no
// bloco de beneficios, ao lado do icone ShieldCheck. Nao existe fluxo de
// troca ou devolucao neste app -- as issues #46 (politica de troca) e #108
// (habilitar status de devolucao/estorno) seguem abertas, e ninguem do lado
// de quem vende recebe um pedido desse tipo. Quem le a promessa compra,
// tenta trocar, nao consegue, e some sem reclamar -- a mesma classe de
// defeito que a release 1.4.0 existe para fechar (ver commit 77a484f, que
// tirou "troca garantida" da home).
//
// Montagem real (react-dom/client + jsdom) reaproveitada de
// product-view-gate-avaliacoes.test.tsx, inclusive os stubs de
// IntersectionObserver, CSS.escape e localStorage que o ProductView precisa
// para montar sem lancar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const getReviewsByProduct = vi.fn();
const subscribeToReviews = vi.fn(() => () => {});
const markHelpful = vi.fn();

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct,
    markHelpful,
    subscribeToReviews,
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

// Mutável de propósito: o caso #571 reescreve `shippingCoverage` para
// "national" e o `beforeEach` repõe o padrão — guarda contra vazamento
// entre testes (mesma técnica de aviso-de-regiao-olha-a-cobertura.test.tsx).
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    enableReviews: true,
    shippingCoverage: "local" as "national" | "local",
    storeCity: "Sao Paulo" as string | undefined,
    storeState: "SP" as string | undefined,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

// @ts-expect-error flag interna do React, sem tipo publico -- mesmo padrao
// do teste vizinho.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-101",
  name: "Produto Avaliado",
  description: "Descricao de teste",
  price: 100,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 4.5,
  reviewCount: 12,
};

describe("ProductView — remove a promessa de troca que o app nao cumpre", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig.shippingCoverage = "local";
    getReviewsByProduct.mockClear();
    subscribeToReviews.mockClear();
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

  it("nao mostra 'Troca garantida' em lugar nenhum da pagina", async () => {
    mockConfig.shippingCoverage = "local";
    const { ProductView } = await import("@/views/customer/ProductView");

    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    expect(hospedeiro.textContent).not.toContain("Troca garantida");
    // Os dois beneficios verdadeiros continuam de pe: entrega e estoque.
    // "Envio rapido" saiu do texto (ProductView-1253): promessa que a loja
    // nao cumpre, mesma regua ja aplicada em CartView/HomeView.
    expect(hospedeiro.textContent).toContain("Entrega em Sao Paulo, SP");
    expect(hospedeiro.textContent).toContain("Produto em estoque");
    expect(hospedeiro.textContent).not.toContain("Envio rápido");
  });

  it("loja com cobertura NACIONAL e cidade configurada nao mostra 'Entrega em' (#571)", async () => {
    // O caso da issue: a loja entrega para o Brasil todo (frete por API);
    // com a cidade na identidade, o selo afirmava "Entrega em <cidade>" —
    // falso para quem não restringe a entrega a ela.
    mockConfig.shippingCoverage = "national";
    const { ProductView } = await import("@/views/customer/ProductView");

    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    expect(hospedeiro.textContent).not.toContain("Entrega em");
    // O que sumiu foi SÓ o bloco de entrega — o estoque continua de pé.
    expect(hospedeiro.textContent).toContain("Produto em estoque");
  });
});
