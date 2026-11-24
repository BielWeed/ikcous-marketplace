// @vitest-environment jsdom
//
// Fronteira do selo "% OFF" no ProductCard: o selo só existe com desconto
// MAIOR que zero. Dois jeitos de o percentual ser 0 com o cartão no ar:
//  - produto sem "De" (a maioria da loja) e marcado como "Em alta": a faixa de
//    selos abre por causa do "EM ALTA", e é ali dentro que um `discount >= 0`
//    escreveria "0% OFF" em todo produto sem promoção;
//  - "De R$ 100,00 por R$ 99,70": 0,3% arredonda para 0. O riscado continua
//    (o preço antigo é verdade), mas o selo "0% OFF" não pode aparecer.
//
// Render de verdade (react-dom/client + jsdom), nos dois desenhos do card.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function produto(ajustes: Partial<Product>): Product {
  return {
    id: "prod-selo-zero",
    name: "Caneca Selo Zero",
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "casa",
    stock: 20,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 4.5,
    reviewCount: 3,
    ...ajustes,
  };
}

describe("ProductCard — selo '% OFF' nunca diz 0%", () => {
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

  async function renderizar(product: Product, layout: "card" | "linha") {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={product}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          showRating={false}
          layout={layout}
          onAddToCartWithVariants={vi.fn()}
        />,
      );
    });
  }

  for (const layout of ["card", "linha"] as const) {
    describe(`desenho '${layout}'`, () => {
      it("produto 'Em alta' sem preço antigo: nenhum selo de desconto", async () => {
        await renderizar(produto({ isBestseller: true }), layout);
        expect(hospedeiro.textContent).toContain("50,00");
        expect(hospedeiro.textContent).not.toContain("OFF");
        expect(hospedeiro.querySelector(".line-through")).toBeNull();
      });

      it("De 100,00 por 99,70 (0,3%): o riscado fica, o selo '0% OFF' não aparece", async () => {
        await renderizar(
          produto({ price: 99.7, originalPrice: 100, isBestseller: true }),
          layout,
        );
        expect(hospedeiro.textContent).toContain("99,70");
        expect(
          hospedeiro.querySelector(".line-through")?.textContent,
        ).toContain("100,00");
        expect(hospedeiro.textContent).not.toContain("OFF");
      });

      it("De 100,00 por 50,00: o selo 50% OFF aparece (o oposto, para a guarda não virar 'nunca')", async () => {
        await renderizar(
          produto({ price: 50, originalPrice: 100, isBestseller: true }),
          layout,
        );
        expect(hospedeiro.textContent).toContain("50% OFF");
      });
    });
  }
});
