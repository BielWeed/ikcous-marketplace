// @vitest-environment jsdom
//
// Caça 30 (06/11/2026), página do produto:
// (a) nome de produto com palavra ou link longo saía cortado na borda da tela
//     -- o título leva `break-words`;
// (b) produto com centenas de avaliações listava todas de uma vez e empurrava
//     Perguntas e Recomendações para o fim de uma rolagem enorme -- a lista
//     mostra 10 e o botão "Ver mais avaliações" soma mais 10. A nota e as
//     barras seguem calculadas sobre TODAS as publicadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, Review } from "@/types";

let avaliacoesDoHook: Review[] = [];

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: avaliacoesDoHook,
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

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-paginas",
  name: "Produto Avaliado",
  description: "Descrição de teste",
  price: 50,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};

function avaliacao(n: number, rating = 5): Review {
  return {
    id: `r${n}`,
    productId: "prod-paginas",
    customerName: `Cliente ${n}`,
    rating,
    comment: `Comentário ${n}`,
    verified: true,
    helpful: 0,
    createdAt: "2026-10-01T12:00:00Z",
  };
}

const muitas = (quantas: number) =>
  Array.from({ length: quantas }, (_, i) => avaliacao(i + 1));

describe("ProductView — título quebra palavra longa e avaliações vêm de 10 em 10", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

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
    hospedeiro = document.createElement("main");
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
    avaliacoesDoHook = [];
  });

  async function montar(p: Product = produto) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={p}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  const comentariosVisiveis = () =>
    Array.from(hospedeiro.querySelectorAll("#reviews-section p")).filter((p) =>
      /^Comentário \d+$/.test(p.textContent ?? ""),
    ).length;

  const botaoVerMais = () =>
    Array.from(hospedeiro.querySelectorAll("#reviews-section button")).find(
      (b) => b.textContent?.includes("Ver mais avaliações"),
    ) as HTMLButtonElement | undefined;

  it("o título do produto leva break-words", async () => {
    await montar({ ...produto, name: `Caneca${"x".repeat(80)}` });
    const titulo = hospedeiro.querySelector("h1");
    expect(titulo?.className).toContain("break-words");
  });

  it("25 avaliações: mostra 10 e o botão; cada toque soma 10; no fim o botão some", async () => {
    avaliacoesDoHook = muitas(25);
    await montar();

    expect(comentariosVisiveis()).toBe(10);
    expect(botaoVerMais()).toBeTruthy();

    await act(async () => {
      botaoVerMais()?.click();
    });
    expect(comentariosVisiveis()).toBe(20);
    expect(botaoVerMais()).toBeTruthy();

    await act(async () => {
      botaoVerMais()?.click();
    });
    expect(comentariosVisiveis()).toBe(25);
    expect(botaoVerMais()).toBeUndefined();
  });

  it("a nota e a contagem seguem sobre TODAS as avaliações, não só as 10 visíveis", async () => {
    avaliacoesDoHook = muitas(25);
    await montar();

    expect(hospedeiro.textContent).toContain("Avaliações (25)");
    expect(hospedeiro.textContent).toContain("Baseado em 25 experiências");
  });

  it("10 avaliações ou menos: sem botão", async () => {
    avaliacoesDoHook = muitas(10);
    await montar();

    expect(comentariosVisiveis()).toBe(10);
    expect(botaoVerMais()).toBeUndefined();
  });

  it("trocar de produto volta a lista para 10", async () => {
    avaliacoesDoHook = muitas(25);
    await montar();
    await act(async () => {
      botaoVerMais()?.click();
    });
    expect(comentariosVisiveis()).toBe(20);

    await montar({ ...produto, id: "outro-produto" });
    expect(comentariosVisiveis()).toBe(10);
  });
});
