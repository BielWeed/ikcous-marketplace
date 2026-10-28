// @vitest-environment jsdom
//
// Escolher uma categoria na tela inicial só filtra o Catálogo: o topo da
// loja (banner, cartão de frete grátis, vitrines e banner do meio) FICA.
// A busca por texto continua mostrando só os resultados.
//
// Monta a HomeView de verdade; só os filhos pesados e o framer-motion são
// dublados (cada um vira uma marca com data-testid).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Category, Product } from "@/types";

const cenario = vi.hoisted(() => ({
  categories: [] as unknown[],
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { freeShippingMin: 100 },
    isLoaded: true,
    catalogoErro: false,
    fetchProducts: vi.fn(async () => {}),
  }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [],
    isLoaded: true,
    loading: false,
    getBannersByPosition: (posicao: string) => [
      { id: `b-${posicao}`, position: posicao },
    ],
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: cenario.categories,
    isLoading: false,
    addCategory: vi.fn(),
  }),
}));
vi.mock("@/hooks/useDocumentMeta", () => ({
  useDocumentMeta: () => ({}),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const PROPS = new Set(["layoutId", "transition", "initial", "animate"]);
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_a, tag) =>
      typeof tag === "string"
        ? ({ children, ...resto }: Record<string, unknown>) =>
            React.createElement(
              tag,
              Object.fromEntries(
                Object.entries(resto).filter(([k]) => !PROPS.has(k)),
              ),
              children as React.ReactNode,
            )
        : undefined,
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
    useReducedMotion: () => true,
  };
});
vi.mock("@/components/ui/custom/BannerCarousel", () => ({
  BannerCarousel: ({ banners }: { banners: { position: string }[] }) => (
    <div data-testid={`banner-${banners[0]?.position}`} />
  ),
}));
vi.mock("@/components/ui/custom/FreeShippingBlock", () => ({
  FreeShippingBlock: () => <div data-testid="frete-gratis" />,
}));
vi.mock("@/components/ui/custom/InfoBlockCarousel", () => ({
  InfoBlockCarousel: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/ui/custom/PremiumOffers", () => ({
  PremiumOffers: ({ title }: { title: string }) => (
    <div data-testid="vitrine-ofertas">{title}</div>
  ),
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: ({ title }: { title: string }) => (
    <div data-testid="vitrine-carrossel">{title}</div>
  ),
}));
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: ({ products }: { products: Product[] }) => (
    <div data-testid="product-list" data-nomes={products.map((p) => p.name)} />
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const umProduto = (
  id: string,
  name: string,
  category: string,
  originalPrice?: number,
) =>
  ({
    id,
    name,
    description: "",
    price: 10,
    originalPrice,
    images: [],
    category,
    stock: 5,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as Product;

const PRODUTOS = [
  umProduto("1", "Sabonete", "Auto cuidado", 20),
  umProduto("2", "Creme", "Auto cuidado"),
  umProduto("3", "Toalha", "Cama & Banho", 30),
];

const umaCategoria = (id: string, name: string) =>
  ({ id, name, isActive: true }) as unknown as Category;

describe("HomeView — categoria escolhida não esconde o topo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    cenario.categories = [
      umaCategoria("c1", "Auto cuidado"),
      umaCategoria("c2", "Cama & Banho"),
    ];
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

  async function montar(selectedCategory: string, searchQuery = "") {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={PRODUTOS}
          favorites={[]}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
          searchQuery={searchQuery}
          selectedCategory={selectedCategory}
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

  const tem = (id: string) =>
    hospedeiro.querySelector(`[data-testid="${id}"]`) !== null;
  const nomesNaLista = () =>
    hospedeiro
      .querySelector('[data-testid="product-list"]')
      ?.getAttribute("data-nomes") ?? null;

  it("com a categoria 'Auto cuidado': topo e vitrines ficam, o Catálogo só tem a categoria", async () => {
    await montar("Auto cuidado");
    expect(tem("banner-home_top")).toBe(true);
    expect(tem("frete-gratis")).toBe(true);
    expect(tem("vitrine-ofertas")).toBe(true);
    expect(hospedeiro.textContent).toContain("Ofertas Imperdíveis");
    expect(tem("banner-home_middle")).toBe(true);
    expect(tem("banner-home_bottom")).toBe(true);
    expect(nomesNaLista()).toBe("Sabonete,Creme");
  });

  it("a vitrine de ofertas é da loja inteira, não só da categoria", async () => {
    await montar("Auto cuidado");
    // "Toalha" (Cama & Banho) é oferta e não aparece no Catálogo filtrado,
    // mas a vitrine continua recebendo as ofertas de toda a loja.
    expect(nomesNaLista()).not.toContain("Toalha");
    expect(tem("vitrine-ofertas")).toBe(true);
  });

  it("em 'Todas' o topo continua igual", async () => {
    await montar("Todas");
    expect(tem("banner-home_top")).toBe(true);
    expect(tem("frete-gratis")).toBe(true);
    expect(tem("vitrine-ofertas")).toBe(true);
    expect(tem("banner-home_middle")).toBe(true);
    expect(tem("banner-home_bottom")).toBe(true);
  });

  it("com busca por texto, o topo some e só ficam os resultados", async () => {
    await montar("Todas", "creme");
    expect(tem("banner-home_top")).toBe(false);
    expect(tem("frete-gratis")).toBe(false);
    expect(tem("vitrine-ofertas")).toBe(false);
    expect(tem("banner-home_middle")).toBe(false);
    expect(tem("banner-home_bottom")).toBe(false);
    expect(nomesNaLista()).toBe("Creme");
  });
});
