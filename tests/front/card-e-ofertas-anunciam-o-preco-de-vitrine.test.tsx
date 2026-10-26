// @vitest-environment jsdom
//
// UI-191 (G3): produto a 50 com "De" 70; tamanho P sem preço próprio e SEM
// estoque; tamanho G a 90 com estoque. O card dizia "De 70 · Por 50 · 29% OFF",
// a faixa de Ofertas "Economize R$ 20" e, ao escolher G, o preço virava 90.
// Agora a vitrine anuncia o menor preço entre as opções à venda e só mostra
// riscado / "% OFF" / economia quando esse preço é menor que o "De".
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const v = (
  id: string,
  extra: Partial<ProductVariant> = {},
): ProductVariant => ({
  id,
  productId: "p1",
  name: "Tamanho",
  value: id,
  stockIncrement: 5,
  active: true,
  ...extra,
});

function produto(extra: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Camiseta Boa",
    description: "",
    price: 50,
    originalPrice: 70,
    images: ["https://example.com/a.png"],
    category: "roupas",
    stock: 9,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

const CASO_DO_DEFEITO = () =>
  produto({
    variants: [
      v("P", { stockIncrement: 0 }),
      v("G", { priceOverride: 90, stockIncrement: 4 }),
    ],
  });

describe("ProductCard — anuncia o preço de vitrine", () => {
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

  async function renderizar(p: Product, layout: "card" | "linha" = "card") {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={p}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          onAddToCartWithVariants={() => 1}
          showRating={false}
          layout={layout}
        />,
      );
    });
  }

  for (const layout of ["card", "linha"] as const) {
    it(`[${layout}] o caso do defeito: mostra R$ 90,00 simples, sem 'De', sem 'Por' e sem '% OFF'`, async () => {
      await renderizar(CASO_DO_DEFEITO(), layout);
      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("90,00");
      expect(texto).not.toContain("70,00");
      expect(texto).not.toContain("50,00");
      expect(texto).not.toMatch(/% OFF/);
      expect(texto).not.toMatch(/A partir de/i);
      expect(hospedeiro.querySelector(".line-through")).toBeNull();
    });

    it(`[${layout}] opções à venda com preços diferentes: o MENOR, 'A partir de', e o desconto só vale para ele`, async () => {
      await renderizar(
        produto({
          variants: [v("P"), v("G", { priceOverride: 90, stockIncrement: 4 })],
        }),
        layout,
      );
      const texto = hospedeiro.textContent ?? "";
      expect(texto).toMatch(/A partir de/i);
      expect(texto).toContain("50,00");
      expect(texto).toContain("70,00");
      expect(texto).toMatch(/29% OFF/);
    });

    it(`[${layout}] produto sem variação com desconto real segue igual: De, Por e % OFF`, async () => {
      await renderizar(produto(), layout);
      const texto = hospedeiro.textContent ?? "";
      expect(texto).toContain("70,00");
      expect(texto).toContain("50,00");
      expect(texto).toMatch(/29% OFF/);
      expect(texto).not.toMatch(/A partir de/i);
    });
  }

  it("a linha de preço do card não quebra: cada linha de preço é nowrap e os selos descem para a própria faixa", async () => {
    await renderizar(produto({ isBestseller: true }));
    const preco = Array.from(hospedeiro.querySelectorAll("span")).find((s) =>
      s.textContent?.includes("50,00"),
    )!;
    expect(preco.className).toContain("whitespace-nowrap");
    const selo = Array.from(hospedeiro.querySelectorAll("span")).find((s) =>
      /% OFF/.test(s.textContent ?? ""),
    )!;
    // O selo NÃO é irmão do bloco de preço na mesma linha: mora numa faixa
    // própria (que quebra de forma controlada) dentro da coluna.
    const faixa = selo.parentElement!;
    expect(faixa.className).toContain("flex-wrap");
    expect(faixa.contains(preco)).toBe(false);
  });
});

describe("Faixa de ofertas — desconto vem do preço de vitrine", () => {
  it("o caso do defeito não é oferta: desconto 0 em vez de 29%", async () => {
    const { ordenarOfertas } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    const [item] = ordenarOfertas([CASO_DO_DEFEITO()]);
    expect(item?.discount).toBe(0);
  });

  it("produto comum com 'De' maior segue com o desconto de sempre", async () => {
    const { ordenarOfertas } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    expect(ordenarOfertas([produto()])[0]?.discount).toBe(29);
  });

  describe("useAcoesDaOferta", () => {
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

    async function ler(p: Product) {
      const { useAcoesDaOferta } = await import(
        "@/components/ui/custom/PremiumOffers"
      );
      let saida!: ReturnType<typeof useAcoesDaOferta>;
      function Sonda() {
        const acoes = useAcoesDaOferta({
          product: p,
          onProductClick: () => {},
          onToggleFavorite: () => {},
        });
        useEffect(() => {
          saida = acoes;
        });
        return null;
      }
      await act(async () => {
        raiz.render(<Sonda />);
      });
      return saida;
    }

    it("o caso do defeito: preço 90, sem 'De' e sem 'Economize'", async () => {
      const r = await ler(CASO_DO_DEFEITO());
      expect(r.preco).toBe(90);
      expect(r.precoAntigo).toBeNull();
      expect(r.savings).toBe(0);
      expect(r.aPartirDe).toBe(false);
    });

    it("duas opções à venda com preços diferentes: o menor, 'a partir de' e a economia dele", async () => {
      const r = await ler(
        produto({
          variants: [v("P"), v("G", { priceOverride: 90, stockIncrement: 4 })],
        }),
      );
      expect(r.preco).toBe(50);
      expect(r.aPartirDe).toBe(true);
      expect(r.savings).toBe(20);
      expect(r.precoAntigo).toBe(70);
    });
  });
});
