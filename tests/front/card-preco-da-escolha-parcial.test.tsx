// @vitest-environment jsdom
//
// Caça 210 (18/11/2026): produto "De R$ 100" em que todas as cores do tamanho M
// custam R$ 50 e todas as do P custam R$ 90. Marcando só o P (cor pendente) o
// card anunciava "R$ 50, de R$ 100, -50%": o menor preço do produto INTEIRO,
// embora nenhuma combinação P custe 50. Completando a cor virava R$ 90 (-10%).
// O preço cobrado nunca esteve errado; o anúncio da escolha parcial estava.
//
// Render de verdade (react-dom/client + jsdom): o que se prova é o texto que a
// cliente lê no card e na folha de opções.
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

const variante = (value: string, priceOverride: number): ProductVariant => ({
  id: value,
  productId: "prod-parcial",
  name: "Cor / Tamanho",
  value,
  stockIncrement: 5,
  priceOverride,
  active: true,
});

function produto(): Product {
  return {
    id: "prod-parcial",
    name: "Camisa Grade",
    description: "Descrição de teste",
    price: 100,
    originalPrice: 100,
    images: ["https://example.com/img.png"],
    category: "roupas",
    stock: 20,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 3,
    variants: [
      variante("Azul / M", 50),
      variante("Verde / M", 50),
      variante("Azul / P", 90),
      variante("Verde / P", 90),
    ],
  };
}

describe("ProductCard — escolha parcial anuncia só o que ainda cabe", () => {
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
      it("sem escolha: o menor do produto, a partir de R$ 50 (-50%)", async () => {
        await renderizar(layout);
        expect(hospedeiro.textContent).toContain("50,00");
        expect(hospedeiro.textContent).toContain("50% OFF");
        expect(hospedeiro.textContent?.toLowerCase()).toContain("a partir de");
      });

      it("só o tamanho P marcado: R$ 90, -10% no card e na folha, sem 'a partir de'", async () => {
        await renderizar(layout);
        await escolher("P");
        const card = hospedeiro.textContent ?? "";
        expect(card).toContain("90,00");
        expect(card).toContain("10% OFF");
        expect(card).not.toContain("50,00");
        expect(card).not.toContain("50% OFF");
        expect(card.toLowerCase()).not.toContain("a partir de");
        const folha = document.body.textContent ?? "";
        expect(folha).toContain("-10%");
        expect(folha).not.toContain("-50%");
      });

      it("só o tamanho M marcado: continua R$ 50 e -50%", async () => {
        await renderizar(layout);
        await escolher("M");
        expect(hospedeiro.textContent).toContain("50,00");
        expect(hospedeiro.textContent).toContain("50% OFF");
        expect(document.body.textContent).toContain("-50%");
      });

      it("escolha completa (P e Verde): R$ 90 e -10%, igual a antes", async () => {
        await renderizar(layout);
        await escolher("P");
        await escolher("Verde");
        expect(hospedeiro.textContent).toContain("90,00");
        expect(hospedeiro.textContent).toContain("10% OFF");
        expect(hospedeiro.textContent).not.toContain("50% OFF");
      });
    });
  }
});
