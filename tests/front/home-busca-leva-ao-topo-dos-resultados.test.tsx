// @vitest-environment jsdom
//
// Começar uma busca com a página rolada para baixo deixava a cliente no FIM da
// lista de resultados: a lista de cima some (a busca esconde banners e
// vitrines), a página encolhe e o navegador mantém a posição antiga — ela via
// o rodapé, não os resultados mais relevantes. Ao COMEÇAR ou TROCAR a busca, a
// Home leva ao título "Resultados da busca" (`#catalogo`).
//
// Controles negativos decidem o teste: rolar sempre (ou a cada render) passaria
// no cenário principal. Montar já com busca, repetir a mesma busca, apagar a
// busca NÃO rolam. Categoria e ordenação levam ao catálogo, exceto na montagem.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";
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
    categories: [
      { id: "bolsas", name: "Bolsas", isActive: true },
      { id: "roupas", name: "Roupas", isActive: true },
    ],
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

const produto = (id: string, name: string, category: string): Product => ({
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
});

const PRODUTOS = [
  produto("bolsa", "Bolsa Preta", "Bolsas"),
  produto("camiseta", "Camiseta Azul", "Roupas"),
];

describe("HomeView — buscar leva ao topo dos resultados", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Cada chamada guarda quem rolou (o id do elemento) e como.
  let rolagens: Array<{ id: string; opcoes: ScrollIntoViewOptions }>;
  let original: unknown;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("CSS", { escape: (valor: string) => valor });
    // O jsdom não implementa scrollIntoView.
    rolagens = [];
    original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (
      this: Element,
      opcoes?: boolean | ScrollIntoViewOptions,
    ) {
      rolagens.push({
        id: this.id,
        opcoes: typeof opcoes === "object" ? opcoes : {},
      });
    };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    if (original === undefined) {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    } else {
      Element.prototype.scrollIntoView = original as Element["scrollIntoView"];
    }
  });

  const render = async (
    props: {
      searchQuery?: string;
      selectedCategory?: string;
      sortBy?: "default" | "price-asc";
    } = {},
  ) => {
    await act(async () => {
      raiz.render(
        <HomeView
          products={PRODUTOS}
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

  it("começar a buscar leva ao título dos resultados, sem animação", async () => {
    await render();
    expect(rolagens).toEqual([]);

    await render({ searchQuery: "bolsa" });

    expect(rolagens).toHaveLength(1);
    expect(rolagens[0].id).toBe("catalogo");
    expect(rolagens[0].opcoes).toMatchObject({
      block: "start",
      behavior: "instant",
    });
  });

  it("com uma categoria marcada (a busca a devolve para Todas) também leva ao topo", async () => {
    await render({ selectedCategory: "Bolsas" });

    await render({ selectedCategory: "Bolsas", searchQuery: "camiseta" });

    expect(rolagens.map((r) => r.id)).toEqual(["catalogo"]);
  });

  it("trocar a busca por outra rola de novo", async () => {
    await render({ searchQuery: "bol" });
    await render({ searchQuery: "bolsa" });
    await render({ searchQuery: "camiseta" });

    // Montou já com busca (não rola); as duas trocas rolam.
    expect(rolagens).toHaveLength(2);
  });

  it("CONTROLE — montar já com uma busca não rola (a cliente chegou aí)", async () => {
    await render({ searchQuery: "bolsa" });
    expect(rolagens).toEqual([]);
  });

  it("CONTROLE — repetir a mesma busca (outro render) não rola", async () => {
    await render({ searchQuery: "bolsa" });
    await render({ searchQuery: "bolsa" });
    await render({ searchQuery: "  bolsa " });
    expect(rolagens).toEqual([]);
  });

  it("CONTROLE — apagar a busca não rola", async () => {
    await render({ searchQuery: "bolsa" });
    await render({ searchQuery: "" });
    expect(rolagens).toEqual([]);
  });

  it("trocar de categoria leva ao início do catálogo", async () => {
    await render();
    await render({ selectedCategory: "Bolsas" });
    expect(rolagens).toEqual([
      { id: "catalogo", opcoes: { block: "start", behavior: "instant" } },
    ]);
  });

  it("trocar a ordenação leva ao início do catálogo", async () => {
    await render();
    await render({ sortBy: "price-asc" });
    expect(rolagens).toEqual([
      { id: "catalogo", opcoes: { block: "start", behavior: "instant" } },
    ]);
  });

  it("CONTROLE — montar com categoria e ordem da URL, ou repetir, não rola", async () => {
    await render({ selectedCategory: "Bolsas", sortBy: "price-asc" });
    await render({ selectedCategory: "Bolsas", sortBy: "price-asc" });
    expect(rolagens).toEqual([]);
  });
});
