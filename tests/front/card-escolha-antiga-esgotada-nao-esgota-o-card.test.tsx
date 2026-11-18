// @vitest-environment jsdom
//
// Caça 210 (18/11/2026): a cliente escolheu o tamanho P e fechou a folha. Depois
// o P acabou, mas o M seguiu com estoque. A escolha antiga fica guardada (a
// limpeza só roda com a folha aberta) e o card dizia "Esgotado" no selo de
// estoque enquanto o botão seguia "Escolher opções", liberado para comprar o M.
// Selo e botão têm de concordar: "Esgotado" só vale com o produto inteiro sem
// estoque, e o número mostrado nunca vem de uma escolha que já não existe.
//
// Render de verdade (react-dom/client + jsdom): o que se prova é o texto que a
// cliente lê no card.
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

const tamanho = (value: string, stockIncrement: number): ProductVariant => ({
  id: value,
  productId: "prod-camisa",
  name: "Tamanho",
  value,
  stockIncrement,
  active: true,
});

function camisa(estoqueP: number, estoqueM: number): Product {
  return {
    id: "prod-camisa",
    name: "Camisa Lisa",
    description: "Descrição de teste",
    price: 100,
    images: ["https://example.com/img.png"],
    category: "roupas",
    stock: estoqueP + estoqueM,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    variants: [tamanho("P", estoqueP), tamanho("M", estoqueM)],
  };
}

describe("ProductCard — escolha antiga esgotada não esgota o card", () => {
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

  const botao = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="product-card-action"]',
    )!;

  // Abre a folha, marca o tamanho e fecha: fica só a escolha guardada.
  async function escolherEFechar(tamanhoEscolhido: string) {
    await act(async () => botao().click());
    const chip = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find(
      (b) =>
        b.getAttribute("aria-label") === tamanhoEscolhido ||
        b.textContent?.trim() === tamanhoEscolhido,
    )!;
    await act(async () => chip.click());
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
  }

  for (const layout of ["card", "linha"] as const) {
    describe(`desenho '${layout}'`, () => {
      it("P escolhido e depois esgotado, M com 8: o card segue à venda", async () => {
        await renderizar(camisa(4, 8), layout);
        await escolherEFechar("P");
        await renderizar(camisa(0, 8), layout);

        expect(botao().textContent).toContain("Escolher opções");
        expect(botao().disabled).toBe(false);
        const texto = hospedeiro.textContent ?? "";
        expect(texto).not.toContain("Esgotado");
        expect(texto).not.toContain("Sem estoque");
        expect(texto).not.toContain("0!");
        expect(texto).toContain("Estoque: 8");
      });

      it("controle: o produto inteiro sem estoque continua Esgotado", async () => {
        await renderizar(camisa(4, 8), layout);
        await escolherEFechar("P");
        await renderizar(camisa(0, 0), layout);

        expect(botao().textContent).toContain("Esgotado");
        expect(botao().disabled).toBe(true);
        expect(hospedeiro.textContent).not.toContain("Estoque: 8");
      });

      it("controle: a escolha guardada com estoque segue mostrando o dela", async () => {
        await renderizar(camisa(4, 8), layout);
        await escolherEFechar("P");

        expect(botao().disabled).toBe(false);
        expect(hospedeiro.textContent).not.toContain("Esgotado");
      });
    });
  }
});
