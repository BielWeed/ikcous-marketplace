// @vitest-environment jsdom
//
// Na primeira visita com a rede falhando a vitrine dizia "Nenhum produto agora
// — Tente buscar por outro termo", como se a loja estivesse vazia, sem botão
// para tentar de novo. Quem separa os dois casos é o `catalogoErro` do
// StoreContext: com erro E lista vazia a Home diz que não conseguiu carregar e
// oferece "Tentar de novo"; sem erro (loja de fato vazia) a mensagem antiga
// fica exatamente como era.
//
// Monta a HomeView de verdade (createRoot + act), filhos pesados dublados --
// mesmo padrão de home-horario-de-funcionamento-chega.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const loja = vi.hoisted(() => ({
  catalogoErro: false,
  fetchProducts: vi.fn(async () => {}),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    catalogoErro: loja.catalogoErro,
    fetchProducts: loja.fetchProducts,
  }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [],
    loading: false,
    getBannersByPosition: () => [],
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useDocumentMeta", () => ({
  useDocumentMeta: () => ({}),
}));
vi.mock("@/components/ui/custom/BannerCarousel", () => ({
  BannerCarousel: () => null,
}));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/FreeShippingBlock", () => ({
  FreeShippingBlock: () => null,
}));
vi.mock("@/components/ui/custom/InfoBlockCarousel", () => ({
  InfoBlockCarousel: () => null,
}));
vi.mock("@/components/ui/custom/PremiumOffers", () => ({
  PremiumOffers: () => null,
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: () => <div data-testid="product-list" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = {
  id: "p1",
  name: "Café",
  description: "",
  price: 10,
  images: [],
  category: "Geral",
  stock: 5,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
} as unknown as Product;

describe("HomeView — rede falhando não parece loja vazia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loja.catalogoErro = false;
    loja.fetchProducts = vi.fn(async () => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar(
    props: {
      products?: Product[];
      isLoading?: boolean;
      searchQuery?: string;
    } = {},
  ) {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={props.products ?? []}
          favorites={[]}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
          searchQuery={props.searchQuery ?? ""}
          isLoading={props.isLoading ?? false}
          selectedCategory="Todas"
          onCategoryChange={vi.fn()}
          sortBy="default"
          onSortByChange={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const botaoTentar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Tentar de novo"),
    );

  it("erro de rede + lista vazia: diz que não conseguiu carregar e oferece tentar de novo", async () => {
    loja.catalogoErro = true;
    await montar();

    expect(hospedeiro.textContent).toContain(
      "Não conseguimos carregar os produtos",
    );
    expect(hospedeiro.textContent).not.toContain("Nenhum produto agora");
    expect(botaoTentar()).toBeDefined();
  });

  it("tocar em 'Tentar de novo' consulta o catálogo de novo", async () => {
    loja.catalogoErro = true;
    await montar();

    await act(async () => {
      botaoTentar()?.click();
    });

    expect(loja.fetchProducts).toHaveBeenCalledTimes(1);
  });

  it("loja de fato sem produtos (sem erro): a mensagem de sempre, sem botão", async () => {
    loja.catalogoErro = false;
    await montar();

    expect(hospedeiro.textContent).toContain("Nenhum produto agora");
    expect(hospedeiro.textContent).not.toContain("Não conseguimos carregar");
    expect(botaoTentar()).toBeUndefined();
  });

  it("com produtos na tela (cópia salva) o aviso NÃO aparece, mesmo com erro", async () => {
    loja.catalogoErro = true;
    await montar({ products: [produto] });

    expect(hospedeiro.textContent).not.toContain("Não conseguimos carregar");
    expect(
      hospedeiro.querySelector('[data-testid="product-list"]'),
    ).not.toBeNull();
  });

  it("enquanto ainda carrega, não mostra o aviso de erro", async () => {
    loja.catalogoErro = true;
    await montar({ isLoading: true });

    expect(hospedeiro.textContent).not.toContain("Não conseguimos carregar");
  });

  it("busca que não acha nada com produtos na loja continua 'Nenhum produto agora'", async () => {
    loja.catalogoErro = true;
    await montar({ products: [produto], searchQuery: "zzzzzz" });

    expect(hospedeiro.textContent).toContain("Nenhum produto agora");
    expect(hospedeiro.textContent).not.toContain("Não conseguimos carregar");
  });
});
