// @vitest-environment jsdom
//
// O cartão grande de Super Ofertas (HeroOfferCard) publicava "X% VENDIDO" com
// uma barra e o selo "Alta Procura" INVENTADOS: `produtos.sold` é 0 em toda
// loja (nada o atualiza), a conta fingia 3 vendas e prendia o resultado entre
// 60% e 95%; o selo era fixo em todo cartão. Isso engana a cliente
// (publicidade enganosa, CDC art. 37). Este arquivo prova que NENHUM dos dois
// aparece, e que o texto de estoque VERDADEIRO continua.
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

// LazyImage cria um IntersectionObserver a cada montagem sem `priority`.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, freeShippingMin: 0 },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoBase: Product = {
  id: "prod-sem-vendas-inventadas",
  name: "Produto Em Oferta",
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

describe("PremiumOffers/HeroOfferCard — não inventa vendas nem procura", () => {
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

  async function renderiza(produto: Product) {
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
  }

  it("sold=0 e estoque 50: sem '% VENDIDO', sem barra, sem 'Alta Procura', com o estoque real", async () => {
    await renderiza(produtoBase);

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/vendido/i);
    expect(texto).not.toContain("Alta Procura");
    // A barra era o único elemento com largura em % inline.
    const barras = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>("[style]"),
    ).filter((el) => el.style.width.endsWith("%"));
    expect(barras).toHaveLength(0);
    expect(texto).toContain("Apenas 50 restantes");
    // O resto do cartão segue idêntico.
    expect(texto).toContain("Super Oferta");
    expect(texto).toContain("20% OFF");
  });

  it("sold alto (não zero) também não vira porcentagem: o cartão não mostra venda nenhuma", async () => {
    await renderiza({ ...produtoBase, sold: 400, stock: 5 });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/vendido/i);
    expect(texto).not.toContain("Alta Procura");
    expect(texto).toContain("Apenas 5 restantes");
  });

  it("1 em estoque: mostra 'Só resta 1!'", async () => {
    await renderiza({ ...produtoBase, stock: 1 });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Só resta 1!");
    expect(texto).not.toContain("Apenas 1 restantes");
    expect(texto).not.toMatch(/vendido/i);
  });
});
