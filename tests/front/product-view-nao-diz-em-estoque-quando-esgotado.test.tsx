// @vitest-environment jsdom
//
// O bloco de beneficios (icone de carrinho, logo abaixo da descricao)
// afirmava sempre "Produto em estoque - Envio rapido", sem nenhuma condicao
// sobre `isOutOfStock`. A MESMA tela, poucos paragrafos acima, ja calcula
// `isOutOfStock` e mostra o selo "Esgotado" com o botao de compra
// desabilitado -- a contradicao ficava visivel na mesma pagina: selo
// "Esgotado" no topo e "em estoque" na secao Detalhes, para o mesmo
// produto. "Envio rapido" tambem nunca existiu de verdade neste app (mesma
// classe de promessa ja removida de CartView.tsx e HomeView.tsx), entao a
// frase toda cai, restando so "Produto em estoque" quando ha estoque.
//
// Montagem real (react-dom/client + jsdom) reaproveitada de
// product-view-remove-troca-garantida.test.tsx, inclusive os stubs de
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      shippingCoverage: "local",
      storeCity: "Sao Paulo",
      storeState: "SP",
    },
    isLoaded: true,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo publico -- mesmo padrao
// do teste vizinho.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoBase: Product = {
  id: "prod-202",
  name: "Produto Esgotavel",
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

describe("ProductView — nao afirma 'em estoque' quando o produto esta esgotado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  it("produto com stock=0 mostra 'Esgotado' no topo e NAO diz 'em estoque' no bloco de detalhes", async () => {
    const produtoEsgotado: Product = { ...produtoBase, stock: 0 };
    const { ProductView } = await import("@/views/customer/ProductView");

    await act(async () => {
      raiz.render(
        <ProductView
          product={produtoEsgotado}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    // Selo do topo, ja correto hoje.
    expect(hospedeiro.textContent).toContain("Esgotado");
    // A contradicao que este teste fecha: o bloco de beneficios nao pode
    // mais afirmar que ha estoque para o mesmo produto esgotado.
    expect(hospedeiro.textContent).not.toContain("Produto em estoque");
    expect(hospedeiro.textContent).not.toContain("Envio rápido");
  });

  it("produto com estoque disponivel mostra 'Produto em estoque', sem a promessa de envio rapido", async () => {
    const produtoComEstoque: Product = { ...produtoBase, stock: 10 };
    const { ProductView } = await import("@/views/customer/ProductView");

    await act(async () => {
      raiz.render(
        <ProductView
          product={produtoComEstoque}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    expect(hospedeiro.textContent).toContain("Produto em estoque");
    // "Envio rapido" nunca existiu de verdade neste app (mesma regua ja
    // aplicada em CartView.tsx e HomeView.tsx) -- a promessa cai de vez.
    expect(hospedeiro.textContent).not.toContain("Envio rápido");
  });
});
