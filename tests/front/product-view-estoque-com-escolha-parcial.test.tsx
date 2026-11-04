// @vitest-environment jsdom
//
// ESTOQUE COM ESCOLHA PARCIAL (caça, achado 14). Produto com grade Tamanho x
// Cor: ao tocar só no tamanho (a cor ainda não escolhida) a etiqueta seguia
// dizendo "Em estoque: <total de TODAS as combinações>" e o seletor aceitava
// essa quantidade, embora só existissem poucas unidades daquele tamanho. O chip
// já sabia o estoque real; a etiqueta ignorava. A compra em si nunca passou
// (exige a combinação completa) -- o erro era a promessa na tela.
//
// Modelo estrutural copiado de product-view-variante-composta.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: vi.fn(() => () => {}),
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
  }),
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
  }),
}));

// jsdom não implementa IntersectionObserver -- o efeito de recomendações do
// ProductView cria um a cada montagem.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const linha = (
  id: string,
  valor: string,
  stockIncrement: number,
): Product["variants"] extends (infer V)[] | undefined ? V : never => ({
  id,
  productId: "p-camiseta",
  name: "Tamanho / Cor",
  value: valor,
  stockIncrement,
  active: true,
});

// P/Azul 4, P/Preto 0, M/Azul 10, M/Preto 18: total 32.
const camiseta: Product = {
  id: "p-camiseta",
  name: "Camiseta",
  description: "Descrição de teste",
  price: 50,
  images: [],
  category: "geral",
  stock: 32,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants: [
    linha("v-p-azul", "P / Azul", 4),
    linha("v-p-preto", "P / Preto", 0),
    linha("v-m-azul", "M / Azul", 10),
    linha("v-m-preto", "M / Preto", 18),
  ],
};

describe("ProductView — a etiqueta de estoque acompanha a escolha PARCIAL", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  async function montar(produto: Product) {
    const { ProductView } = await import("@/views/customer/ProductView");
    await act(async () => {
      raiz.render(
        <ProductView
          product={produto}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      );
    });
  }

  async function tocarChip(rotulo: string) {
    const chip = hospedeiro.querySelector(
      `button[aria-label="${rotulo}"]`,
    ) as HTMLButtonElement | null;
    expect(chip, `chip "${rotulo}"`).not.toBeNull();
    await act(async () => {
      chip?.click();
    });
  }

  const etiquetaDeEstoque = () =>
    [...hospedeiro.querySelectorAll("span")]
      .map((el) => el.textContent ?? "")
      .find((texto) => texto.startsWith("Em estoque:"));

  it("sem escolha nenhuma, a etiqueta mostra o total do produto", async () => {
    await montar(camiseta);
    expect(etiquetaDeEstoque()).toBe("Em estoque: 32");
  });

  it("só o tamanho P escolhido: a etiqueta mostra as 4 unidades de P, não as 32 do produto", async () => {
    await montar(camiseta);
    await tocarChip("P");
    expect(etiquetaDeEstoque()).toBe("Em estoque: 4");
  });

  it("só o tamanho M escolhido: a etiqueta soma as cores de M (28)", async () => {
    await montar(camiseta);
    await tocarChip("M");
    expect(etiquetaDeEstoque()).toBe("Em estoque: 28");
  });

  it("tamanho e cor escolhidos: vale o estoque da combinação (M / Azul = 10)", async () => {
    await montar(camiseta);
    await tocarChip("M");
    await tocarChip("Azul");
    expect(etiquetaDeEstoque()).toBe("Em estoque: 10");
  });
});
