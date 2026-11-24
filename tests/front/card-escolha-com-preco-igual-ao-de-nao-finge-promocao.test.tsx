// @vitest-environment jsdom
//
// Fronteira do "De" riscado no ProductCard COM escolha feita: produto base a
// R$ 60, "De" R$ 100, tamanho M a R$ 60 e tamanho P com preço próprio de
// R$ 100 -- exatamente igual ao "De". Sem escolha o card anuncia "a partir de
// R$ 60, De R$ 100, 40% OFF". Ao marcar o P a cliente paga R$ 100: não existe
// desconto, então não pode haver "De" riscado, "Por" nem selo (um "De R$ 100,00
// Por R$ 100,00" seria promoção falsa). A guarda é `originalPrice > precoAtual`
// (estritamente maior); com `>=` o card riscava um preço igual ao cobrado.
//
// Render de verdade (react-dom/client + jsdom), nos dois desenhos do card.
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
  productId: "prod-igual-ao-de",
  name: "Tamanho",
  value,
  stockIncrement: 5,
  priceOverride,
  active: true,
});

function produto(): Product {
  return {
    id: "prod-igual-ao-de",
    name: "Camisa Fronteira",
    description: "Descrição de teste",
    price: 60,
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
    variants: [variante("M", 60), variante("P", 100)],
  };
}

describe("ProductCard — escolha cujo preço é igual ao 'De' não finge promoção", () => {
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
    document.body.innerHTML = "";
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
      it("sem escolha: a partir de R$ 60, com o 'De' R$ 100 riscado e 40% OFF", async () => {
        await renderizar(layout);
        expect(hospedeiro.textContent).toContain("60,00");
        expect(hospedeiro.textContent).toContain("40% OFF");
        expect(
          hospedeiro.querySelector(".line-through")?.textContent,
        ).toContain("100,00");
      });

      it("marca o P (R$ 100, igual ao 'De'): preço simples, sem riscado, sem selo e sem 'Por'", async () => {
        await renderizar(layout);
        await escolher("P");
        const card = hospedeiro.textContent ?? "";
        expect(card).toContain("100,00");
        expect(card).not.toContain("OFF");
        expect(card).not.toContain("60,00");
        expect(hospedeiro.querySelector(".line-through")).toBeNull();
        expect(
          hospedeiro.querySelector(".sr-only")?.textContent ?? "",
        ).not.toMatch(/^Por/);
      });

      it("marca o M (R$ 60): o desconto de verdade volta, 40% OFF sobre o 'De' de R$ 100", async () => {
        await renderizar(layout);
        await escolher("M");
        expect(hospedeiro.textContent).toContain("60,00");
        expect(hospedeiro.textContent).toContain("40% OFF");
        expect(
          hospedeiro.querySelector(".line-through")?.textContent,
        ).toContain("100,00");
      });
    });
  }
});
