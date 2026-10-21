// @vitest-environment jsdom
//
// Categoria que não existe na lista da loja (link velho ou quebrado, como
// `/?category=Cama ` de um banner "Cama & Banho" mal gravado) não pode
// deixar a cliente diante de "Nenhum produto agora" sem nenhum botão de
// categoria marcado: a Home cai em "Todas". Categoria que existe continua
// filtrando e marcando o botão certo, inclusive com "&", "+" e "#" no nome.
//
// NÃO esconde categoria vazia: a lojista pode criar uma "em breve", e ela
// continua aparecendo e abrindo uma lista vazia (decisão de produto).
//
// Monta a HomeView de verdade com o CategoryFilter de verdade (createRoot +
// act); só os filhos pesados e o framer-motion são dublados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Category, Product } from "@/types";

const cenario = vi.hoisted(() => ({
  categories: [] as unknown[],
  isLoading: false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    catalogoErro: false,
    fetchProducts: vi.fn(async () => {}),
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
  useCategories: () => ({
    categories: cenario.categories,
    isLoading: cenario.isLoading,
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
  BannerCarousel: () => null,
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
  ProductList: ({ products }: { products: Product[] }) => (
    <div data-testid="product-list" data-nomes={products.map((p) => p.name)} />
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const umProduto = (id: string, name: string, category: string) =>
  ({
    id,
    name,
    description: "",
    price: 10,
    images: [],
    category,
    stock: 5,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as Product;

const umaCategoria = (id: string, name: string, isActive = true) =>
  ({ id, name, isActive }) as unknown as Category;

const PRODUTOS = [
  umProduto("1", "Toalha", "Cama & Banho"),
  umProduto("2", "Suco", "Bebidas"),
  umProduto("3", "Vela", "Mais+Vendidos"),
  umProduto("4", "Caneca", "Moda #1"),
];

describe("HomeView — categoria que não existe cai em Todas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    cenario.categories = [
      umaCategoria("c1", "Cama & Banho"),
      umaCategoria("c2", "Bebidas"),
      umaCategoria("c3", "Mais+Vendidos"),
      umaCategoria("c4", "Moda #1"),
      umaCategoria("c5", "Em breve"),
      umaCategoria("c6", "Escondida", false),
    ];
    cenario.isLoading = false;
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

  async function montar(selectedCategory: string) {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={PRODUTOS}
          favorites={[]}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
          searchQuery=""
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

  const marcados = () =>
    Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>(
        'button[aria-pressed="true"]',
      ),
    )
      .map((b) => b.getAttribute("aria-label"))
      .filter((rotulo) => rotulo?.startsWith("Selecionar categoria"));

  const nomesNaLista = () =>
    hospedeiro
      .querySelector('[data-testid="product-list"]')
      ?.getAttribute("data-nomes") ?? null;

  it("mostra a contagem filtrada junto do mesmo botão de filtros", async () => {
    await montar("Cama & Banho");
    expect(
      hospedeiro.querySelector('[data-testid="resultado-categoria"]')
        ?.textContent,
    ).toBe("Cama & Banho · 1 produto");
    const filtro = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Filtrar e Ordenar"]',
    )!;
    expect(filtro.textContent).toContain("Filtros");
    await act(async () => {
      filtro.click();
    });
    expect(hospedeiro.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it.each([
    ["Cama & Banho", "Toalha"],
    ["Mais+Vendidos", "Vela"],
    ["Moda #1", "Caneca"],
    ["Bebidas", "Suco"],
  ])(
    "categoria '%s' existe: filtra e marca o botão certo",
    async (nome, produto) => {
      await montar(nome);
      expect(marcados()).toEqual([`Selecionar categoria ${nome}`]);
      expect(nomesNaLista()).toBe(produto);
    },
  );

  it.each(["Cama ", "Inexistente", "Escondida", "Cama"])(
    "categoria '%s' não existe na lista: cai em Todas, com todos os produtos",
    async (nome) => {
      await montar(nome);
      expect(marcados()).toEqual(["Selecionar categoria Todas"]);
      expect(nomesNaLista()).toBe("Toalha,Suco,Vela,Caneca");
      expect(hospedeiro.textContent).not.toContain("Nenhum produto agora");
    },
  );

  it("letra maiúscula/minúscula diferente ainda acha a categoria e marca o botão dela", async () => {
    await montar("cama & banho");
    expect(marcados()).toEqual(["Selecionar categoria Cama & Banho"]);
    expect(nomesNaLista()).toBe("Toalha");
  });

  it("categoria vazia (em breve) continua existindo: lista vazia, botão marcado", async () => {
    await montar("Em breve");
    expect(marcados()).toEqual(["Selecionar categoria Em breve"]);
    expect(hospedeiro.textContent).toContain("Nenhum produto agora");
  });

  it("enquanto as categorias carregam, não decide nada (sem piscar em Todas)", async () => {
    cenario.categories = [];
    cenario.isLoading = true;
    await montar("Cama & Banho");
    expect(nomesNaLista()).toBe("Toalha");
  });

  it("lista de categorias vazia (falha ao carregar): mantém a categoria pedida", async () => {
    cenario.categories = [];
    await montar("Cama & Banho");
    expect(nomesNaLista()).toBe("Toalha");
  });
});
