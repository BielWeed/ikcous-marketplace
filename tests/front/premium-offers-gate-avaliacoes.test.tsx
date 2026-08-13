// @vitest-environment jsdom
//
// Issue #202 (ADMIN-091): a home continuava publicando "★★★★☆ (12)" no
// carrossel de Super Ofertas (PremiumOffers/HeroOfferCard) mesmo com
// `store_config.enable_reviews = false` -- a página do produto já escondia
// isso (#101), mas este componente lê `useStore()` só para frete grátis, não
// para avaliação. Este arquivo prova os dois estados.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de product-view-gate-avaliacoes.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// embla-carousel-react usa ResizeObserver internamente -- ausente no jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// LazyImage (dentro do HeroOfferCard) cria um IntersectionObserver a cada
// montagem quando `priority` não é passado -- o que é o caso aqui.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let enableReviews = true;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews, freeShippingMin: 0 },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão de
// checkout-view-flag-off.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto: Product = {
  id: "prod-202",
  name: "Produto Avaliado",
  description: "Descrição de teste",
  price: 80,
  originalPrice: 100,
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

describe("PremiumOffers/HeroOfferCard — gate do interruptor de Avaliações (ADMIN-091, #202)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    // embla-carousel consulta `window.matchMedia` para os breakpoints das
    // options -- ausente no jsdom.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
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
    enableReviews = true;
  });

  it("com o flag DESLIGADO, some a estrela, a contagem e o separador -- 'Alta Procura' continua", async () => {
    enableReviews = false;
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

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(0);
    expect(hospedeiro.textContent).not.toContain("(12)");
    expect(hospedeiro.textContent).toContain("Alta Procura");
  });

  it("com o flag LIGADO, continua exatamente como hoje: 5 estrelas, contagem e separador", async () => {
    enableReviews = true;
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

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(5);
    expect(hospedeiro.textContent).toContain("(12)");
    expect(hospedeiro.textContent).toContain("Alta Procura");
  });
});
