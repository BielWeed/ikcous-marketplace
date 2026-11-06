// @vitest-environment jsdom
//
// DEFEITO: nome de produto com uma palavra comprida e sem espaço (ex.:
// "Superhipermegaultraconfortavel...") passava da largura do card da vitrine e
// era cortado sem reticências. O nome do layout em linha já tinha `break-words`;
// o botão do nome no layout em card (ProductCard) e no cartão grande de Super
// Ofertas (PremiumOffers) não tinha.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, freeShippingMin: 0 },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const NOME_LONGO = "Superhipermegaultraconfortavelparatodososdiasdoanointeiro";

const produto: Product = {
  id: "prod-nome-longo",
  name: NOME_LONGO,
  description: "Descrição de teste",
  price: 80,
  originalPrice: 100,
  images: ["https://example.com/img.png"],
  category: "geral",
  stock: 50,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 5,
  reviewCount: 0,
};

describe("nome de produto com palavra longa quebra dentro do card", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const botaoDoNome = () =>
    Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("h3 button"),
    ).find((b) => b.textContent?.trim() === NOME_LONGO);

  it("ProductCard (layout em card): o botão do nome tem break-words", async () => {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={vi.fn()}
          showRating={false}
        />,
      );
    });

    const botao = botaoDoNome();
    expect(botao).toBeDefined();
    expect(botao?.className).toContain("break-words");
  });

  it("PremiumOffers (cartão grande de Super Ofertas): o botão do nome tem overflow-wrap:anywhere (a coluna flex do md+ não encolhe só com break-words)", async () => {
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produto]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    const botao = botaoDoNome();
    expect(botao).toBeDefined();
    expect(botao?.className).toContain("[overflow-wrap:anywhere]");
  });
});
