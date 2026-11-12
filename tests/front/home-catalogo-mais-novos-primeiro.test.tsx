// @vitest-environment jsdom
//
// O Catálogo da vitrine perdia a ordem "mais novos primeiro": produto que chega
// pelo Realtime entra no fim da lista, e depois de pausar/excluir um produto
// (ou sem internet) a lista vinha em ordem de uuid. Em "Relevância" sem busca a
// Home agora desempata pela data de cadastro (a mesma régua de
// `ordenarParaVitrine`), depois do "com estoque na frente". Quando as datas
// empatam, o id decide. Preco diferente continua valendo antes da data.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product, SortOption } from "@/types";
import { HomeView } from "@/views/customer/HomeView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true }),
}));
vi.mock("@/lib/supabase", () => {
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.single = () => Promise.resolve({ data: null, error: null });
  return {
    supabase: {
      from: () => consulta,
      rpc: () => Promise.resolve({ data: false, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "roupas", name: "Roupas", isActive: true }],
    isLoading: false,
  }),
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { readonly product: Product }) => (
    <article data-produto={product.id}>{product.name}</article>
  ),
}));

const produto = (
  id: string,
  extras: Partial<Product> = {},
  stock = 5,
): Product => ({
  id,
  name: `Produto ${id}`,
  description: "",
  price: 100,
  images: [],
  category: "Roupas",
  stock,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
  ...extras,
});

describe("HomeView — Catálogo em 'Relevância' sem busca: mais novos primeiro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (valor: string) => valor });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const render = async (
    produtos: Product[],
    props: { sortBy?: SortOption; searchQuery?: string } = {},
  ) => {
    await act(async () => {
      raiz.render(
        <HomeView
          products={produtos}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          selectedCategory="Todas"
          searchQuery={props.searchQuery ?? ""}
          sortBy={props.sortBy ?? "default"}
          onCategoryChange={() => {}}
          onSortByChange={() => {}}
        />,
      );
    });
  };

  const ordemNaTela = () =>
    Array.from(hospedeiro.querySelectorAll("[data-produto]")).map((card) =>
      card.getAttribute("data-produto"),
    );

  it("lista fora de ordem sai com o mais novo primeiro e o esgotado no fim", async () => {
    await render([
      produto("velho", { createdTime: 1000 }),
      produto("esgotado-novissimo", { createdTime: 5000 }, 0),
      produto("novo", { createdTime: 3000 }),
      produto("medio", { createdTime: 2000 }),
    ]);

    expect(ordemNaTela()).toEqual([
      "novo",
      "medio",
      "velho",
      "esgotado-novissimo",
    ]);
  });

  it("datas iguais (ou sem data) desempatam pelo id", async () => {
    await render([
      produto("c"),
      produto("a", { createdTime: 100 }),
      produto("b"),
      produto("d", { createdTime: 100 }),
    ]);

    // Com data na frente; id decide entre datas iguais e tambem entre ausentes.
    expect(ordemNaTela()).toEqual(["a", "d", "b", "c"]);
  });

  it.each(["price-asc", "price-desc", "default"] as const)(
    "%s desempata por mais novo e id, independente da chegada",
    async (sortBy) => {
      const produtos = [
        produto("z", { createdTime: 1000 }),
        produto("c", { createdTime: 3000 }),
        produto("a", { createdTime: 3000 }),
        produto("esgotado", { createdTime: 5000 }, 0),
      ];
      for (const lista of [produtos, [...produtos].reverse()]) {
        await render(lista, { sortBy, searchQuery: "produto" });
        expect(ordemNaTela()).toEqual(["a", "c", "z", "esgotado"]);
      }
    },
  );

  it("ordem por preço não é mexida pela data", async () => {
    await render(
      [
        produto("caro-novo", { createdTime: 3000, price: 300 }),
        produto("barato-velho", { createdTime: 1000, price: 100 }),
        produto("medio-medio", { createdTime: 2000, price: 200 }),
      ],
      { sortBy: "price-asc" },
    );

    expect(ordemNaTela()).toEqual(["barato-velho", "medio-medio", "caro-novo"]);
  });
});
