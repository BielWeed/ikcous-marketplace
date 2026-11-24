// @vitest-environment jsdom
//
// Desempates da lista da Home que a fixture dos testes vizinhos NAO distingue
// (caca por mutacao, 24/11/2026): la a ordem de chegada do catalogo coincide
// com "mais novo primeiro", entao tirar o desempate passava. Aqui a ordem de
// chegada e' EMBARALHADA de proposito:
//  - ordenacao por preco (menor/maior) com precos iguais: a data mais nova e,
//    na mesma data, o id menor decidem -- nao a ordem em que o cache entregou;
//  - busca com pontuacao empatada ("Bolsa A", "Bolsa B"...): idem;
//  - a categoria marcada compara sem espaco nas pontas dos DOIS lados;
//  - trocar a ordenacao com a lista ja na tela REORDENA (a lista nao pode ficar
//    presa a ordem com que a tela nasceu).
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
const CATEGORIAS_DA_LOJA = [
  { id: "bolsas", name: "Bolsas", isActive: true },
  { id: "roupas", name: "Roupas", isActive: true },
];
let categoriasDaLoja = CATEGORIAS_DA_LOJA;
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: categoriasDaLoja, isLoading: false }),
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
  name: string,
  category: string,
  extras: Partial<Product> = {},
): Product => ({
  id,
  name,
  description: "",
  price: 100,
  images: [],
  category,
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-08T00:00:00.000Z",
  ...extras,
});

// Chegada embaralhada. Mesmo preco/nome-base para empatar tudo.
const EMBARALHADOS = [
  produto("a", "Bolsa A", "Bolsas", { createdTime: 1000 }),
  produto("d", "Bolsa D", "Bolsas", { createdTime: 2000 }),
  produto("c", "Bolsa C", "Bolsas", { createdTime: 2000 }),
  produto("b", "Bolsa B", "Bolsas", { createdTime: 3000 }),
];

// Precos diferentes: a ordem por data e a ordem por preco nao coincidem.
const PRECOS = [
  produto("caro", "Bolsa Cara", "Bolsas", { price: 300, createdTime: 3000 }),
  produto("medio", "Bolsa Media", "Bolsas", { price: 200, createdTime: 2000 }),
  produto("barato", "Bolsa Barata", "Bolsas", {
    price: 100,
    createdTime: 1000,
  }),
];

const COM_ESPACO = [
  produto("sem-espaco", "Bolsa Preta", "Bolsas", { createdTime: 3000 }),
  produto("com-espaco", "Bolsa Rosa", "Bolsas ", { createdTime: 2000 }),
  produto("outra", "Camisa", "Roupas", { createdTime: 1000 }),
];

describe("HomeView — desempates com chegada embaralhada e categoria com espaço", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    categoriasDaLoja = CATEGORIAS_DA_LOJA;
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

  const render = async (props: {
    produtos: Product[];
    searchQuery?: string;
    selectedCategory?: string;
    sortBy?: SortOption;
  }) => {
    await act(async () => {
      raiz.render(
        <HomeView
          products={props.produtos}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          selectedCategory={props.selectedCategory ?? "Todas"}
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

  it("menor preço com preços iguais: data mais nova primeiro e, na mesma data, o id menor", async () => {
    await render({ produtos: EMBARALHADOS, sortBy: "price-asc" });
    expect(ordemNaTela()).toEqual(["b", "c", "d", "a"]);
  });

  it("maior preço com preços iguais: o mesmo desempate", async () => {
    await render({ produtos: EMBARALHADOS, sortBy: "price-desc" });
    expect(ordemNaTela()).toEqual(["b", "c", "d", "a"]);
  });

  it("busca com a mesma pontuação para todos: o desempate é a data e depois o id", async () => {
    await render({ produtos: EMBARALHADOS, searchQuery: "bolsa" });
    expect(ordemNaTela()).toEqual(["b", "c", "d", "a"]);
  });

  it("categoria marcada COM espaço no fim acha produto cadastrado com e sem espaço", async () => {
    await render({ produtos: COM_ESPACO, selectedCategory: "Bolsas " });
    expect(ordemNaTela()).toEqual(["sem-espaco", "com-espaco"]);
  });

  it("categoria marcada SEM espaço acha o produto cadastrado com espaço no fim", async () => {
    await render({ produtos: COM_ESPACO, selectedCategory: "Bolsas" });
    expect(ordemNaTela()).toEqual(["sem-espaco", "com-espaco"]);
  });

  it("trocar a ordenação com a lista na tela reordena: padrão, menor preço, maior preço", async () => {
    await render({ produtos: PRECOS, sortBy: "default" });
    expect(ordemNaTela()).toEqual(["caro", "medio", "barato"]);

    await render({ produtos: PRECOS, sortBy: "price-asc" });
    expect(ordemNaTela()).toEqual(["barato", "medio", "caro"]);

    await render({ produtos: PRECOS, sortBy: "price-desc" });
    expect(ordemNaTela()).toEqual(["caro", "medio", "barato"]);

    await render({ produtos: PRECOS, sortBy: "price-asc" });
    expect(ordemNaTela()).toEqual(["barato", "medio", "caro"]);
  });

  it("sem a lista de categorias da loja (falha de rede) vale o nome marcado, com e sem espaço no fim", async () => {
    categoriasDaLoja = [];
    await render({ produtos: COM_ESPACO, selectedCategory: "Bolsas " });
    expect(ordemNaTela()).toEqual(["sem-espaco", "com-espaco"]);
  });

  it("ancora: outra categoria não entra", async () => {
    await render({ produtos: COM_ESPACO, selectedCategory: "Roupas" });
    expect(ordemNaTela()).toEqual(["outra"]);
  });
});
