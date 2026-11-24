// @vitest-environment jsdom
//
// ProductCard (desenhos "card" e "linha"): o que a cliente lê nas BORDAS das
// regras de preço e de estoque. O caso comum (De 100 por 80 = 20% OFF) já tinha
// teste; aqui ficam as fronteiras onde um `<` virar `<=` ou um arredondamento
// virar corte mudaria o que está escrito no card:
//  - "De" igual, menor ou ausente: nenhum riscado nem selo;
//  - 22,5% vira 23% (e 0,4% não vira selo "0% OFF");
//  - preço zero é 100% OFF e aparece como R$ 0,00;
//  - o aviso de estoque baixo muda exatamente em 1, 5/6 e 0, com a concordância
//    certa em cada desenho;
//  - esgotado não ostenta "% OFF" no desenho de linha.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false, freeShippingMin: 0 } }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function produto(extra: Partial<Product> = {}): Product {
  return {
    id: "p-borda",
    name: "Camiseta Borda",
    description: "",
    price: 80,
    originalPrice: 100,
    images: ["https://example.com/a.png"],
    category: "roupas",
    stock: 20,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

describe("ProductCard - bordas do selo, do riscado e do estoque", () => {
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

  async function renderizar(p: Product, layout: "card" | "linha") {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={p}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          onAddToCart={() => 1}
          showRating={false}
          layout={layout}
        />,
      );
    });
  }
  const texto = () => hospedeiro.textContent ?? "";

  for (const layout of ["card", "linha"] as const) {
    describe(`desenho '${layout}'`, () => {
      it.each([
        ["preço igual ao 'De'", 80, 80],
        ["preço MAIOR que o 'De'", 120, 100],
        ["'De' zero", 80, 0],
      ])(
        "%s: sem riscado, sem selo e sem 'De'",
        async (_nome, preco, antigo) => {
          await renderizar(
            produto({ price: preco, originalPrice: antigo }),
            layout,
          );
          expect(texto()).toContain(formatCurrency(preco));
          expect(texto()).not.toMatch(/% OFF/);
          expect(texto()).not.toMatch(/De:?\s*R\$/);
          expect(hospedeiro.querySelector(".line-through")).toBeNull();
        },
      );

      it("'De' ausente (null do banco): preço simples, sem selo", async () => {
        await renderizar(
          produto({ originalPrice: null as unknown as undefined }),
          layout,
        );
        expect(texto()).not.toMatch(/% OFF/);
        expect(hospedeiro.querySelector(".line-through")).toBeNull();
      });

      it("22,5% arredonda para cima: De 40 por 31 é 23% OFF, nunca 22%", async () => {
        await renderizar(produto({ price: 31, originalPrice: 40 }), layout);
        expect(texto()).toMatch(/23% OFF/);
        expect(texto()).not.toMatch(/22% OFF/);
      });

      it("desconto de 0,4% não vira selo '0% OFF'", async () => {
        await renderizar(produto({ price: 996, originalPrice: 1000 }), layout);
        expect(texto()).not.toMatch(/\d+% OFF/);
      });

      it("desconto de 0,4% num produto 'Em alta': mostra EM ALTA, mas nunca '0% OFF'", async () => {
        await renderizar(
          produto({ price: 996, originalPrice: 1000, isBestseller: true }),
          layout,
        );
        expect(texto()).toMatch(/em alta/i);
        expect(texto()).not.toMatch(/\d+% OFF/);
      });

      it("preço zero é 100% OFF e aparece como R$ 0,00", async () => {
        await renderizar(produto({ price: 0, originalPrice: 50 }), layout);
        expect(texto()).toMatch(/100% OFF/);
        expect(texto()).toContain(formatCurrency(0));
      });

      it("desconto real mostra o 'De' riscado com o valor antigo e o preço novo", async () => {
        await renderizar(produto(), layout);
        expect(texto()).toMatch(/20% OFF/);
        const riscado = hospedeiro.querySelector(".line-through");
        expect(riscado?.textContent).toContain(formatCurrency(100));
        expect(texto()).toContain(formatCurrency(80));
      });
    });
  }

  describe("aviso de estoque - desenho 'card' (grade)", () => {
    it.each([
      [1, "Resta apenas 1!"],
      [2, "Restam apenas 2!"],
      [5, "Restam apenas 5!"],
      [6, "Estoque: 6"],
      [20, "Estoque: 20"],
    ])("estoque %i mostra '%s'", async (estoque, frase) => {
      await renderizar(produto({ stock: estoque }), "card");
      expect(texto()).toContain(frase);
    });

    it("estoque 6 não usa o aviso de pouca unidade", async () => {
      await renderizar(produto({ stock: 6 }), "card");
      expect(texto()).not.toMatch(/Restam? apenas/);
    });

    it("estoque 0 diz 'Esgotado' no selo e no botão, e nunca 'Restam apenas 0!'", async () => {
      await renderizar(produto({ stock: 0 }), "card");
      expect(texto()).toContain("Esgotado");
      expect(texto()).not.toMatch(/Restam? apenas/);
      expect(texto()).not.toContain("Estoque: 0");
      const botao = hospedeiro.querySelector<HTMLButtonElement>(
        'button[data-testid="product-card-action"]',
      );
      expect(botao?.disabled).toBe(true);
    });
  });

  describe("aviso de estoque - desenho 'linha'", () => {
    it.each([
      [1, "Resta 1"],
      [2, "Restam 2"],
      [5, "Restam 5"],
      [6, "Estoque: 6"],
      [20, "Estoque: 20"],
    ])("estoque %i mostra '%s'", async (estoque, frase) => {
      await renderizar(produto({ stock: estoque }), "linha");
      expect(texto()).toContain(frase);
    });

    it("estoque 6 não usa o aviso de pouca unidade", async () => {
      await renderizar(produto({ stock: 6 }), "linha");
      expect(texto()).not.toMatch(/Restam? \d/);
    });

    it("estoque 0 diz 'Sem estoque' e o botão 'Esgotado' fica travado", async () => {
      await renderizar(produto({ stock: 0 }), "linha");
      expect(texto()).toContain("Sem estoque");
      expect(texto()).not.toMatch(/Restam? \d/);
      const botao = hospedeiro.querySelector<HTMLButtonElement>(
        'button[data-testid="product-card-action"]',
      );
      expect(botao?.disabled).toBe(true);
      expect(botao?.textContent).toContain("Esgotado");
    });

    it("esgotado não ostenta '% OFF' (a cliente não pode comprar), mas mantém o preço", async () => {
      await renderizar(produto({ stock: 0 }), "linha");
      expect(texto()).not.toMatch(/% OFF/);
      expect(texto()).toContain(formatCurrency(80));
    });
  });

  describe("desenho 'card' - faixa de selos", () => {
    const faixasVazias = () =>
      Array.from(hospedeiro.querySelectorAll("div.flex-wrap")).filter(
        (faixa) => (faixa.textContent ?? "").trim() === "",
      );

    it("sem desconto e sem 'Em alta': não deixa uma faixa de selos vazia (ela abre um vão no card)", async () => {
      await renderizar(produto({ price: 80, originalPrice: 80 }), "card");
      expect(faixasVazias()).toHaveLength(0);
    });

    it("desconto menor que meio por cento e sem 'Em alta': também sem faixa vazia", async () => {
      await renderizar(produto({ price: 996, originalPrice: 1000 }), "card");
      expect(faixasVazias()).toHaveLength(0);
    });
  });

  describe('"A partir de" some quando a cliente escolhe uma opção', () => {
    const comOpcoes = () =>
      produto({
        price: 80,
        originalPrice: 100,
        variants: [
          {
            id: "v-p",
            productId: "p-borda",
            name: "Tamanho",
            value: "P",
            stockIncrement: 5,
            active: true,
          },
          {
            id: "v-g",
            productId: "p-borda",
            name: "Tamanho",
            value: "G",
            stockIncrement: 5,
            priceOverride: 90,
            active: true,
          },
        ],
      });

    for (const layout of ["card", "linha"] as const) {
      it(`[${layout}] antes de escolher anuncia 'A partir de' o menor preço; depois de escolher G, só o preço do G`, async () => {
        const { ProductCard } = await import(
          "@/components/ui/custom/ProductCard"
        );
        await act(async () => {
          raiz.render(
            <ProductCard
              product={comOpcoes()}
              isFavorite={false}
              onToggleFavorite={() => {}}
              onClick={() => {}}
              showRating={false}
              layout={layout}
              onAddToCartWithVariants={vi.fn()}
            />,
          );
        });
        expect(texto()).toMatch(/A partir de/i);
        expect(texto()).toContain(formatCurrency(80));

        await act(async () => {
          hospedeiro
            .querySelector<HTMLButtonElement>(
              'button[data-testid="product-card-action"]',
            )!
            .click();
        });
        const chip = Array.from(
          document.querySelectorAll<HTMLButtonElement>("button"),
        ).find(
          (b) =>
            b.getAttribute("aria-label") === "G" ||
            b.textContent?.trim() === "G",
        )!;
        await act(async () => chip.click());

        expect(texto()).toContain(formatCurrency(90));
        expect(texto()).not.toMatch(/A partir de/i);
      });
    }
  });
});
