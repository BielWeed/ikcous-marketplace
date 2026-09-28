// @vitest-environment jsdom
//
// Lacuna de teste apontada na revisão: `preco-promocional-verde.test.tsx`
// cobre o "Por:" do ProductCard/PremiumOffers e
// `product-view-barra-fixa-preco-promocional.test.tsx` cobre só a barra de
// compra FIXA da página do produto (o preço pequeno, text-emerald-700) —
// nenhum arquivo cobria o preço GRANDE do bloco principal da página do
// produto ("Price & Promo Badges Row", ProductView.tsx), que usa
// CLASSE_PRECO_PROMOCIONAL_TEXTO_GRANDE (`text-emerald-600`). Este arquivo
// fecha essa lacuna.
//
// Modelo estrutural copiado de product-view-estoque-contraste-aa.test.tsx
// (mesmos dublês e stubs de jsdom).
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

const produtoEmPromocao: Product = {
  id: "prod-preco-grande-promo",
  name: "Produto Em Promoção",
  description: "Descrição de teste",
  price: 12.9,
  originalPrice: 24.9,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};

const produtoSemPromocao: Product = {
  ...produtoEmPromocao,
  id: "prod-preco-grande-sem-promo",
  originalPrice: undefined,
};

/** O preço grande é o único "R$ ..." em `text-2xl` do bloco principal —
 * distinto do "De: R$ ..." (riscado, text-zinc-400) e da barra dockada
 * (não existe sem `scrolled=true`, que o jsdom nunca liga sozinho). */
function encontraPrecoGrande(hospedeiro: HTMLElement): Element | undefined {
  return Array.from(hospedeiro.querySelectorAll("span.text-2xl")).find((el) =>
    el.textContent?.trim().startsWith("R$"),
  );
}

describe("ProductView — preço promocional GRANDE (bloco principal) usa verde, não vermelho", () => {
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

  it("com promoção: o preço grande usa text-emerald-600, não text-rose-600", async () => {
    const { ProductView } = await import("@/views/customer/ProductView");

    await act(async () => {
      raiz.render(
        <ProductView
          product={produtoEmPromocao}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    const preco = encontraPrecoGrande(hospedeiro);
    expect(preco).not.toBeUndefined();
    expect(preco?.textContent?.trim()).toBe("R$ 12,90");
    expect(preco?.classList.contains("text-emerald-600")).toBe(true);
    expect(preco?.classList.contains("text-rose-600")).toBe(false);
    expect(preco?.classList.contains("text-red-600")).toBe(false);
  });

  it("sem promoção: o preço grande é neutro (text-zinc-900), não verde nem vermelho", async () => {
    const { ProductView } = await import("@/views/customer/ProductView");

    await act(async () => {
      raiz.render(
        <ProductView
          product={produtoSemPromocao}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });

    const preco = encontraPrecoGrande(hospedeiro);
    expect(preco).not.toBeUndefined();
    expect(preco?.classList.contains("text-zinc-900")).toBe(true);
    expect(preco?.classList.contains("text-emerald-600")).toBe(false);
    expect(preco?.classList.contains("text-rose-600")).toBe(false);
  });
});
