// @vitest-environment jsdom
//
// Faixa "Ofertas Imperdíveis" da Home (PremiumOffers) -- dois defeitos que a
// cliente sentia:
//   A. a lojista escolhe à mão (Painel > Vitrines > Ofertas) um produto SEM
//      preço promocional ("De/Por"): o card herói não mostrava preço nenhum,
//      porque o bloco de preço só existia dentro de `originalPrice && (...)`.
//   B. a faixa reordenava só por desconto, desfazendo o "disponível primeiro"
//      que a Home já aplica: uma oferta ESGOTADA com maior desconto abria a
//      faixa antes das disponíveis.
// Esta suíte só prova A e B -- o preço calculado, o estoque, o carrinho e o
// checkout não são tocados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function stubGlobaisDeLayout() {
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
}

function criarProduto(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-oferta",
    name: "Camiseta Lisa",
    description: "Descrição de teste",
    price: 50,
    images: ["https://example.com/img.png"],
    category: "roupas",
    stock: 40,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    rating: 5,
    reviewCount: 0,
    ...overrides,
  };
}

describe("PremiumOffers — preço e ordem da faixa de ofertas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    stubGlobaisDeLayout();
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
    vi.doUnmock("@/contexts/StoreContext");
  });

  async function renderizar(products: Product[]) {
    vi.doMock("@/contexts/StoreContext", () => ({
      useStore: () => ({
        config: { enableReviews: false, freeShippingMin: 0 },
      }),
    }));
    const { PremiumOffers } = await import(
      "@/components/ui/custom/PremiumOffers"
    );
    await act(async () => {
      raiz.render(
        <PremiumOffers
          products={products}
          favorites={[]}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onAddToCart={vi.fn()}
          onQuickBuy={vi.fn()}
        />,
      );
    });
  }

  function nomesNaOrdem(): string[] {
    return Array.from(hospedeiro.querySelectorAll("h3")).map(
      (h) => h.textContent ?? "",
    );
  }

  describe("A — o preço aparece mesmo sem preço promocional", () => {
    it("sem originalPrice: mostra o preço atual simples, sem De/Por nem riscado", async () => {
      await renderizar([criarProduto({ price: 50, originalPrice: undefined })]);

      expect(hospedeiro.textContent).toContain(formatCurrency(50));
      expect(hospedeiro.textContent).not.toContain("De:");
      expect(hospedeiro.textContent).not.toContain("Por:");
      expect(hospedeiro.textContent).not.toContain("Economize");
      expect(hospedeiro.querySelector(".line-through")).toBeNull();
    });

    it("com originalPrice: continua De (riscado) / Por / Economize, como sempre", async () => {
      await renderizar([criarProduto({ price: 50, originalPrice: 80 })]);

      expect(hospedeiro.textContent).toContain(`De: ${formatCurrency(80)}`);
      expect(hospedeiro.textContent).toContain(`Por: ${formatCurrency(50)}`);
      expect(hospedeiro.textContent).toContain(
        `Economize ${formatCurrency(30)}`,
      );
      expect(hospedeiro.querySelector(".line-through")).not.toBeNull();
    });

    it("originalPrice igual ao preço atual não finge promoção: preço simples, sem riscado", async () => {
      await renderizar([criarProduto({ price: 50, originalPrice: 50 })]);

      expect(hospedeiro.textContent).toContain(formatCurrency(50));
      expect(hospedeiro.textContent).not.toContain("De:");
      expect(hospedeiro.querySelector(".line-through")).toBeNull();
    });

    it("sem originalPrice o preço aparece UMA vez só", async () => {
      await renderizar([criarProduto({ price: 50, originalPrice: undefined })]);

      const ocorrencias = hospedeiro.textContent?.split(formatCurrency(50));
      expect(ocorrencias).toHaveLength(2);
    });
  });

  // Preço atual 50: originalPrice 55 = ~9% OFF, 100 = 50% OFF.
  function oferta(name: string, originalPrice: number, stock: number) {
    return criarProduto({ id: name, name, originalPrice, stock });
  }

  describe("B — disponível antes de esgotado, depois por desconto", () => {
    it("esgotada com desconto maior NÃO abre a faixa (esgotada primeiro na lista)", async () => {
      await renderizar([
        oferta("Esgotada", 100, 0),
        oferta("Disponivel", 55, 10),
      ]);

      expect(nomesNaOrdem()).toEqual(["Disponivel", "Esgotada"]);
    });

    it("esgotada com desconto maior NÃO abre a faixa (disponível primeiro na lista)", async () => {
      await renderizar([
        oferta("Disponivel", 55, 10),
        oferta("Esgotada", 100, 0),
      ]);

      expect(nomesNaOrdem()).toEqual(["Disponivel", "Esgotada"]);
    });

    it("entre as disponíveis, o maior desconto abre; entre as esgotadas também", async () => {
      await renderizar([
        oferta("Esgotada 10", 55, 0),
        oferta("Disponivel 10", 55, 5),
        oferta("Esgotada 50", 100, 0),
        oferta("Disponivel 50", 100, 5),
      ]);

      expect(nomesNaOrdem()).toEqual([
        "Disponivel 50",
        "Disponivel 10",
        "Esgotada 50",
        "Esgotada 10",
      ]);
    });

    it("empate mantém a ordem recebida (estável), inclusive sem preço promocional", async () => {
      await renderizar([
        criarProduto({ id: "1", name: "Primeiro", originalPrice: undefined }),
        criarProduto({ id: "2", name: "Segundo", originalPrice: undefined }),
        criarProduto({ id: "3", name: "Terceiro", originalPrice: 100 }),
      ]);

      expect(nomesNaOrdem()).toEqual(["Terceiro", "Primeiro", "Segundo"]);
    });
  });
});
