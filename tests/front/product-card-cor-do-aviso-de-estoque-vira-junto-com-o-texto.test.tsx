// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território "estoque na vitrine". O teste de
// bordas do ProductCard prova a FRASE do estoque (1, 5/6, 0), mas oito mutantes
// que mexiam só na COR do aviso no limite (`<= 5` virar `< 5` ou `<= 6`, na
// bolinha e no texto, nos dois desenhos) sobreviviam: com 5 peças o texto
// dizia "Restam 5" e a cor continuava a de estoque tranquilo (ou o contrário
// com 6 peças, "Estoque: 6" em cor de alerta). Aqui o limite vale para a frase,
// a bolinha e a cor do texto JUNTOS, em cada desenho:
//  - grade ('card'): 1 e 5 em rosa, 6 e 20 em verde, 0 em cinza (Esgotado);
//  - linha ('linha'): 1 e 5 em âmbar, 6 e 20 neutro com bolinha verde, 0 em
//    vermelho (Sem estoque).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function produto(estoque: number): Product {
  return {
    id: "p-cor-estoque",
    name: "Camiseta Cor do Estoque",
    description: "",
    price: 80,
    images: ["https://example.com/a.png"],
    category: "roupas",
    stock: estoque,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
}

describe("ProductCard - a cor do aviso de estoque muda no mesmo limite da frase", () => {
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

  async function renderizar(estoque: number, layout: "card" | "linha") {
    const { ProductCard } = await import("@/components/ui/custom/ProductCard");
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produto(estoque)}
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

  /** O span que carrega a frase do estoque e a bolinha que vem com ele. */
  function aviso(frase: string): { texto: HTMLElement; bolinha: HTMLElement } {
    // "Esgotado" também é o rótulo do botão: só vale o span que tem a bolinha
    // (`rounded-full`) como primeiro filho ou como irmão anterior.
    const achados = Array.from(hospedeiro.querySelectorAll("span")).filter(
      (s) =>
        s.textContent === frase &&
        (s.firstElementChild ?? s.previousElementSibling)?.classList.contains(
          "rounded-full",
        ),
    );
    expect(achados).toHaveLength(1);
    const texto = achados[0] as HTMLElement;
    // Linha: a bolinha é o primeiro filho do próprio span. Grade: é o irmão
    // anterior do span do texto.
    const bolinha = (texto.firstElementChild ??
      texto.previousElementSibling) as HTMLElement;
    expect(bolinha).not.toBeNull();
    return { texto, bolinha };
  }

  describe("desenho 'card' (grade)", () => {
    it.each([
      [1, "Resta apenas 1!"],
      [5, "Restam apenas 5!"],
    ])("estoque %i: frase, bolinha e texto em rosa", async (estoque, frase) => {
      await renderizar(estoque, "card");
      const { texto, bolinha } = aviso(frase);
      expect(texto.classList.contains("text-rose-600")).toBe(true);
      expect(bolinha.classList.contains("bg-rose-500")).toBe(true);
    });

    it.each([
      [6, "Estoque: 6"],
      [20, "Estoque: 20"],
    ])(
      "estoque %i: frase, bolinha e texto em verde",
      async (estoque, frase) => {
        await renderizar(estoque, "card");
        const { texto, bolinha } = aviso(frase);
        expect(texto.classList.contains("text-emerald-700")).toBe(true);
        expect(texto.classList.contains("text-rose-600")).toBe(false);
        expect(bolinha.classList.contains("bg-emerald-500")).toBe(true);
        expect(bolinha.classList.contains("bg-rose-500")).toBe(false);
      },
    );

    it("estoque 0: 'Esgotado' em cinza, nunca rosa nem verde", async () => {
      await renderizar(0, "card");
      const { texto, bolinha } = aviso("Esgotado");
      expect(texto.classList.contains("text-zinc-500")).toBe(true);
      expect(bolinha.classList.contains("bg-zinc-400")).toBe(true);
    });
  });

  describe("desenho 'linha'", () => {
    it.each([
      [1, "Resta 1"],
      [5, "Restam 5"],
    ])(
      "estoque %i: frase, bolinha e texto em âmbar",
      async (estoque, frase) => {
        await renderizar(estoque, "linha");
        const { texto, bolinha } = aviso(frase);
        expect(texto.classList.contains("text-amber-700")).toBe(true);
        expect(bolinha.classList.contains("bg-amber-500")).toBe(true);
      },
    );

    it.each([
      [6, "Estoque: 6"],
      [20, "Estoque: 20"],
    ])(
      "estoque %i: texto neutro e bolinha verde, sem âmbar",
      async (estoque, frase) => {
        await renderizar(estoque, "linha");
        const { texto, bolinha } = aviso(frase);
        expect(texto.classList.contains("text-muted-foreground")).toBe(true);
        expect(texto.classList.contains("text-amber-700")).toBe(false);
        expect(bolinha.classList.contains("bg-emerald-600")).toBe(true);
        expect(bolinha.classList.contains("bg-amber-500")).toBe(false);
      },
    );

    it("estoque 0: 'Sem estoque' em vermelho", async () => {
      await renderizar(0, "linha");
      const { texto, bolinha } = aviso("Sem estoque");
      expect(texto.classList.contains("text-red-700")).toBe(true);
      expect(bolinha.classList.contains("bg-red-600")).toBe(true);
    });
  });
});
