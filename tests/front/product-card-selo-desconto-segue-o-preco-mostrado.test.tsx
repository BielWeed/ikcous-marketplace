// @vitest-environment jsdom
//
// Caça 4 (24/10/2026), achado V1: o "% OFF" do card saía do preço BASE do
// produto, mas o preço mostrado é o da variação escolhida. Produto de R$ 80
// (original R$ 100) com a variação G a R$ 90 mostrava "De 100 / Por 90" com
// selo "20% OFF" (o certo é 10%); com a variação a R$ 120 o card mostrava
// R$ 120 SEM riscado e o selo "20% OFF" continuava lá. A página do produto já
// calculava pelo preço da escolha; o card agora também.
//
// Render de verdade (react-dom/client + jsdom): o que se prova é o texto
// que a cliente lê, nos dois desenhos do card ("card" e "linha").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function variantes(): ProductVariant[] {
  return [
    {
      id: "var-p",
      productId: "prod-selo",
      name: "Tamanho",
      value: "P",
      stockIncrement: 5,
      active: true,
    },
    {
      id: "var-g",
      productId: "prod-selo",
      name: "Tamanho",
      value: "G",
      stockIncrement: 5,
      priceOverride: 90,
      active: true,
    },
    {
      id: "var-gg",
      productId: "prod-selo",
      name: "Tamanho",
      value: "GG",
      stockIncrement: 5,
      priceOverride: 120,
      active: true,
    },
  ];
}

function produto(): Product {
  return {
    id: "prod-selo",
    name: "Camisa Promo",
    description: "Descrição de teste",
    price: 80,
    originalPrice: 100,
    images: ["https://example.com/img.png"],
    category: "roupas",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 3,
    variants: variantes(),
  };
}

describe("ProductCard — selo '% OFF' segue o preço mostrado (V1)", () => {
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

  async function renderizar(layout: "card" | "linha") {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto()}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          showRating={false}
          layout={layout}
          onAddToCartWithVariants={vi.fn()}
        />,
      );
    });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[data-testid="product-card-action"]',
        )!
        .click();
    });
  }

  const escolher = async (texto: string) => {
    const chip = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (b) =>
        b.getAttribute("aria-label") === texto ||
        b.textContent?.trim() === texto,
    )!;
    await act(async () => chip.click());
  };

  for (const layout of ["card", "linha"] as const) {
    describe(`desenho '${layout}'`, () => {
      it("sem escolha: usa o preço do produto (20% OFF de 100 para 80)", async () => {
        await renderizar(layout);
        expect(hospedeiro.textContent).toContain("20% OFF");
      });

      it("variação com preço próprio MENOR que o original: o % sai do preço mostrado (10%, não 20%)", async () => {
        await renderizar(layout);
        await escolher("G");
        expect(hospedeiro.textContent).toContain("90,00");
        expect(hospedeiro.textContent).toContain("10% OFF");
        expect(hospedeiro.textContent).not.toContain("20% OFF");
      });

      it("variação com preço próprio ACIMA do original: sem riscado e sem selo", async () => {
        await renderizar(layout);
        await escolher("GG");
        expect(hospedeiro.textContent).toContain("120,00");
        expect(hospedeiro.textContent).not.toContain("% OFF");
        expect(hospedeiro.textContent).not.toContain("100,00");
      });
    });
  }
});
