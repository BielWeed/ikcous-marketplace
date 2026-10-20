// @vitest-environment jsdom
//
// DEFEITO (caçada de 14/10/2026, venda perdida): a QUANTIDADE escolhida na
// folha de opções do card era IGNORADA — entrava sempre 1 — na grade do
// Catálogo (ProductList) e em "Você também pode gostar" (ProductView). O
// ProductCard já entregava a quantidade (4º argumento), mas os dois repasses
// só levavam 3 argumentos (produto, variação, nomes) e o do ProductView ainda
// fixava `1`. O ProductCarousel (Home) já repassava certo e serve de CONTROLE.
//
// Aqui o ProductCard é o REAL: escolhe "M", sobe a quantidade para 3 e toca em
// "Adicionar" na folha. Quem recebe do outro lado é um espião.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, ProductVariant } from "@/types";

const estado = vi.hoisted(() => ({
  recomendados: [] as unknown[],
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false },
    isLoaded: true,
  }),
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

vi.mock("@/hooks/useRecomendacoesDeProduto", () => ({
  useRecomendacoesDeProduto: () => ({
    recomendacoes: estado.recomendados,
    carregando: false,
    consultado: true,
  }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

vi.mock("@/components/ui/custom/ProductQA", () => ({
  ProductQA: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function variantes(): ProductVariant[] {
  return [
    {
      id: "v-m",
      productId: "p-vestido",
      name: "Tamanho",
      value: "M",
      stockIncrement: 10,
      active: true,
    },
    {
      id: "v-g",
      productId: "p-vestido",
      name: "Tamanho",
      value: "G",
      stockIncrement: 10,
      active: true,
    },
  ];
}

const vestido: Product = {
  id: "p-vestido",
  name: "Vestido Midi",
  description: "x",
  price: 120,
  images: ["https://example.com/v.png"],
  category: "vestidos",
  stock: 20,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  rating: 5,
  reviewCount: 0,
  variants: variantes(),
};

const paginaAtual: Product = {
  ...vestido,
  id: "p-pagina",
  name: "Camiseta da Página",
  variants: [],
};

let raiz: Root;
let hospedeiro: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("CSS", { escape: (v: string) => v });
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: false,
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  estado.recomendados = [vestido];
  hospedeiro = document.createElement("main");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function tocar(el: Element | null | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function escolherMQuantidade3EAdicionar() {
  await tocar(hospedeiro.querySelector('[data-testid="product-card-action"]'));
  const chipM = Array.from(document.body.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === "M" && b.getAttribute("aria-pressed") !== null,
  );
  await tocar(chipM);
  // Dentro da FOLHA: a página do produto tem um seletor igual, mais acima.
  const mais = document.body.querySelector(
    '[data-testid="product-card-options-sheet"] button[aria-label="Aumentar quantidade"]',
  );
  await tocar(mais);
  await tocar(mais);
  await tocar(
    document.body.querySelector('[data-testid="product-card-options-add"]'),
  );
}

describe("a quantidade escolhida na folha de opções chega ao carrinho", () => {
  it("grade do Catálogo (ProductList): quantidade 3 chega como 3", async () => {
    const { ProductList } = await import("@/components/ui/custom/ProductList");
    const espiao = vi.fn();
    await act(async () => {
      raiz.render(
        <ProductList
          products={[vestido]}
          isLoading={false}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onAddToCartWithVariants={espiao}
        />,
      );
    });

    await escolherMQuantidade3EAdicionar();

    expect(espiao).toHaveBeenCalledTimes(1);
    expect(espiao).toHaveBeenCalledWith(vestido, "v-m", "Tamanho: M", 3);
  });

  it("controle — carrossel da Home (ProductCarousel): quantidade 3 chega como 3", async () => {
    const { ProductCarousel } = await import(
      "@/components/ui/custom/ProductCarousel"
    );
    const espiao = vi.fn();
    await act(async () => {
      raiz.render(
        <ProductCarousel
          title="Novidades"
          products={[vestido]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onAddToCartWithVariants={espiao}
        />,
      );
    });

    await escolherMQuantidade3EAdicionar();

    expect(espiao).toHaveBeenCalledWith(vestido, "v-m", "Tamanho: M", 3);
  });

  it("'Você também pode gostar' (ProductView): quantidade 3 chega como 3, não 1", async () => {
    const { ProductView } = await import("@/views/customer/ProductView");
    const onAddToCartProduct = vi.fn();
    await act(async () => {
      raiz.render(
        <ProductView
          product={paginaAtual}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={vi.fn()}
          onBack={() => {}}
          onAddToCartProduct={onAddToCartProduct}
        />,
      );
    });

    await escolherMQuantidade3EAdicionar();

    expect(onAddToCartProduct).toHaveBeenCalledTimes(1);
    expect(onAddToCartProduct).toHaveBeenCalledWith(
      vestido,
      3,
      "v-m",
      "Tamanho: M",
    );
  });

  it("'Você também pode gostar': sem mexer na quantidade, continua entrando 1", async () => {
    const { ProductView } = await import("@/views/customer/ProductView");
    const onAddToCartProduct = vi.fn();
    await act(async () => {
      raiz.render(
        <ProductView
          product={paginaAtual}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={vi.fn()}
          onBack={() => {}}
          onAddToCartProduct={onAddToCartProduct}
        />,
      );
    });

    await tocar(
      hospedeiro.querySelector('[data-testid="product-card-action"]'),
    );
    const chipM = Array.from(document.body.querySelectorAll("button")).find(
      (b) =>
        b.textContent?.trim() === "M" &&
        b.getAttribute("aria-pressed") !== null,
    );
    await tocar(chipM);
    await tocar(
      document.body.querySelector('[data-testid="product-card-options-add"]'),
    );

    expect(onAddToCartProduct).toHaveBeenCalledWith(
      vestido,
      1,
      "v-m",
      "Tamanho: M",
    );
  });
});
