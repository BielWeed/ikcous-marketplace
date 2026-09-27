// @vitest-environment jsdom
//
// Pedido do Gabriel (27/09/2026, testando o preview): quando o produto tem
// promoção (`originalPrice` maior que o preço atual), o valor "Por:" ficava
// em vermelho/rosa (`text-rose-600`) -- a MESMA cor que o resto da loja usa
// pra "negativo" (estoque baixo, erro, cancelado). Vermelho passa a mensagem
// errada; verde é o sinal certo pra promoção. Este arquivo prova o valor
// promocional em VERDE (contraste AA, ver src/lib/cor-do-preco-promocional.ts)
// no card da vitrine (e na folha de opções, mesmo card) e no carrossel
// "Ofertas Imperdíveis" (PremiumOffers/HeroOfferCard) -- os dois prints que o
// dono mandou. O selo de desconto ("% OFF") continua vermelho de propósito:
// não é o valor do produto, é fora do escopo deste pedido.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// mesmo raciocínio de product-card-estoque-contraste-aa.test.tsx -- a classe
// de cor vive no elemento renderizado, não em dado estático.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductCard } from "@/components/ui/custom/ProductCard";
import type { Product } from "@/types";

// PremiumOffers lê `useStore()` (frete grátis) -- sem mock, o StoreContext de
// verdade puxa o cliente Supabase e o EnvGuard reclama de variável de
// ambiente ausente no teste. Mesmo mock de premium-offers-gate-avaliacoes.test.tsx.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, freeShippingMin: 0 },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoEmPromocao: Product = {
  id: "prod-promo-verde-1",
  name: "Produto Em Promoção",
  description: "",
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

function encontraPrecoPor(hospedeiro: HTMLDivElement): Element | undefined {
  return Array.from(hospedeiro.querySelectorAll("span")).find((el) =>
    el.textContent?.trim().startsWith("Por:"),
  );
}

describe("ProductCard — preço promocional ('Por:') usa verde, não vermelho/rosa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("card da vitrine: 'Por:' troca text-rose-600 por text-emerald-700", async () => {
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produtoEmPromocao}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating={false}
        />,
      );
    });

    const preco = encontraPrecoPor(hospedeiro);
    expect(preco).not.toBeUndefined();
    expect(preco?.classList.contains("text-emerald-700")).toBe(true);
    expect(preco?.classList.contains("text-rose-600")).toBe(false);
    expect(preco?.classList.contains("text-red-600")).toBe(false);
  });
});

describe("PremiumOffers/HeroOfferCard — preço promocional ('Por:') usa verde, não vermelho/rosa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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
  });

  it("carrossel 'Ofertas Imperdíveis': 'Por:' troca text-rose-600 por text-emerald-600", async () => {
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );

    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produtoEmPromocao]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    const preco = encontraPrecoPor(hospedeiro);
    expect(preco).not.toBeUndefined();
    expect(preco?.classList.contains("text-emerald-600")).toBe(true);
    expect(preco?.classList.contains("text-rose-600")).toBe(false);
    expect(preco?.classList.contains("text-red-600")).toBe(false);
  });

  it("o selo de desconto ('% OFF') continua vermelho -- fora do escopo deste pedido", async () => {
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );

    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={[produtoEmPromocao]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
        />,
      );
    });

    const selo = Array.from(hospedeiro.querySelectorAll("span")).find((el) =>
      el.textContent?.trim().endsWith("% OFF"),
    );
    expect(selo).not.toBeUndefined();
    expect(selo?.classList.contains("text-rose-600")).toBe(true);
  });
});
