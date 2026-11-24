// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território "estoque na página do produto".
// O teste vizinho (`product-view-quantidade-acompanha-o-estoque-da-variacao`)
// prova a troca de variação com estoque de SOBRA e com estoque MENOR, mas não
// o limite exato: quantidade IGUAL ao estoque da nova variação. Um mutante que
// trocava `quantity > estoque` por `>=` passava em tudo e mostrava à cliente
// "Só restam 3 / Ajustamos a quantidade para 3" sem nada para ajustar.
//   - 3 na mão, nova variação com 3: nada muda e NENHUM aviso;
//   - 4 na mão, nova variação com 3: vira 3 e avisa (o outro lado do limite).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const avisar = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    warning: (...args: unknown[]) => avisar(...args),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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
    config: { enableReviews: false },
    isLoaded: true,
  }),
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function cor(id: string, valor: string, estoque: number): ProductVariant {
  return {
    id,
    productId: "p-camiseta",
    name: "Cor",
    value: valor,
    stockIncrement: estoque,
    active: true,
  };
}

function produtoCom(variants: ProductVariant[]): Product {
  return {
    id: "p-camiseta",
    name: "Camiseta",
    description: "Descrição de teste",
    price: 50,
    images: ["/foto-1.png"],
    category: "roupas",
    stock: 12,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    variants,
  };
}

describe("ProductView — a quantidade acompanha o estoque da variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let adicionarAoCarrinho: ReturnType<
    typeof vi.fn<
      (quantity: number, variantId?: string, variantNames?: string) => void
    >
  >;

  beforeEach(() => {
    avisar.mockClear();
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
    adicionarAoCarrinho = vi.fn();
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
          onAddToCart={adicionarAoCarrinho}
          onBack={() => {}}
        />,
      );
    });
  }

  function opcao(valor: string) {
    const span = [...hospedeiro.querySelectorAll("button span")].find(
      (el) => el.textContent === valor,
    );
    return span?.closest("button") as HTMLButtonElement;
  }

  async function tocar(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      (el as HTMLElement).click();
    });
  }

  async function aumentar(vezes: number) {
    const mais = hospedeiro.querySelector(
      "button[aria-label='Aumentar quantidade']",
    );
    for (let i = 0; i < vezes; i++) await tocar(mais);
  }

  // A quantidade que a tela MANDARIA ao carrinho (o número animado deixa os
  // valores antigos no DOM do jsdom, então não se lê o seletor).
  async function quantidadeQueVaiAoCarrinho() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Adicionar ao Carrinho"),
    );
    await tocar(botao);
    expect(adicionarAoCarrinho).toHaveBeenCalledTimes(1);
    return adicionarAoCarrinho.mock.calls[0][0];
  }

  it("3 na mão e a nova variação tem exatamente 3: nada muda e nenhum aviso", async () => {
    await montar(
      produtoCom([cor("v-verm", "Vermelho", 10), cor("v-azul", "Azul", 3)]),
    );

    await tocar(opcao("Vermelho"));
    await aumentar(2);

    await tocar(opcao("Azul"));

    expect(avisar).not.toHaveBeenCalled();
    expect(await quantidadeQueVaiAoCarrinho()).toBe(3);
  });

  it("4 na mão e a nova variação tem 3: vira 3 e avisa", async () => {
    await montar(
      produtoCom([cor("v-verm", "Vermelho", 10), cor("v-azul", "Azul", 3)]),
    );

    await tocar(opcao("Vermelho"));
    await aumentar(3);

    await tocar(opcao("Azul"));

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(String(avisar.mock.calls[0][0])).toBe("Só restam 3");
    expect(await quantidadeQueVaiAoCarrinho()).toBe(3);
  });
});
