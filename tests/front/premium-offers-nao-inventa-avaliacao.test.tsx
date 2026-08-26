// @vitest-environment jsdom
//
// LOJA-01 (auditoria 26/08/2026): mesmo raciocínio de
// product-card-nao-inventa-avaliacao.test.tsx, aplicado ao carrossel de
// Super Ofertas. `HeroOfferCard` renderizava `<StarRating rating={product
// .rating || 5} />` sempre que `showRating` (config.enableReviews) era
// verdadeiro, sem checar `reviewCount`. Com `produtos.rating` sempre em 5
// (DEFAULT do banco, nunca recalculado), a faixa "Super Descontos" publicava
// nota e estrela para produto sem uma avaliação sequer.
//
// POR QUE RENDER DE VERDADE, NÃO DUBLÊ: mesmo raciocínio de
// premium-offers-gate-avaliacoes.test.tsx.
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    // O flag fica sempre LIGADO neste arquivo -- o que este teste prova é
    // outro eixo (reviewCount), não o interruptor de Avaliações (já coberto
    // por premium-offers-gate-avaliacoes.test.tsx).
    config: { enableReviews: true, freeShippingMin: 0 },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoBase: Product = {
  id: "prod-loja01",
  name: "Produto Nunca Avaliado",
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
  rating: 5,
  reviewCount: 0,
};

describe("PremiumOffers/HeroOfferCard — não inventa avaliação sem reviewCount (LOJA-01)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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
  });

  it("reviewCount=0: nem estrela, nem contagem, nem separador -- 'Alta Procura' continua sozinho", async () => {
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );

    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produtoBase]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(0);
    expect(hospedeiro.textContent).not.toContain("(0)");
    expect(hospedeiro.textContent).toContain("Alta Procura");
  });

  it("reviewCount>0: a estrela e a contagem continuam aparecendo (não regride o caso avaliado)", async () => {
    const produtoAvaliado: Product = {
      ...produtoBase,
      reviewCount: 12,
      rating: 4.5,
    };
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );

    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produtoAvaliado]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    expect(hospedeiro.querySelectorAll("svg.lucide-star").length).toBe(5);
    expect(hospedeiro.textContent).toContain("(12)");
  });
});
