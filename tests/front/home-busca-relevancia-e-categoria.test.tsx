// @vitest-environment jsdom
//
// Dois furos entre a caixinha da busca do topo e a lista da Home:
//
// 1) RELEVÂNCIA (achado 13). O menu de ordenação marca "Relevância", mas a lista
//    de "Resultados da busca" vinha na ordem do cadastro: a pontuação (nome
//    igual > começa com > contém > palavra > categoria > descrição) só ordenava
//    a caixinha. Uma "Camisa" nova que cita "bolsa" na descrição passava na
//    frente da "Bolsa Preta" antiga. Agora a lista usa a MESMA pontuação,
//    depois do "com estoque primeiro", e sem busca a ordem do catálogo segue.
//
// 2) CATEGORIA (achado 12). Com a categoria "Bolsas" marcada, a caixinha
//    contava "Produtos (4)" na loja inteira e o "Ver todos os resultados"
//    mostrava menos (ou "Nenhum produto agora"): a lista ainda filtrava pela
//    categoria. A busca do topo é na loja inteira -- o mesmo que a caixinha
//    conta --, então começar uma busca devolve a categoria para "Todas".
//    Tocar numa categoria DEPOIS de buscar continua valendo (escolha dela).
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

// A ordem do catálogo é a da lista (mais novo primeiro): camisa, bolsa, ...
const PRODUTOS = [
  produto("camisa", "Camisa Nova", "Roupas", {
    createdTime: 3000,
    description: "Combina com a bolsa preta",
  }),
  produto("bolsa", "Bolsa Preta", "Bolsas", { createdTime: 2000 }),
  produto("camiseta", "Camiseta Azul", "Roupas", { createdTime: 1000 }),
  produto("bolsa-esgotada", "Bolsa Vermelha", "Bolsas", { stock: 0 }),
];

describe("HomeView — a busca usa a relevância e olha a loja inteira", () => {
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
    props: {
      searchQuery?: string;
      selectedCategory?: string;
      sortBy?: SortOption;
      onCategoryChange?: (categoria: string) => void;
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
          onCategoryChange={props.onCategoryChange ?? (() => {})}
          onSortByChange={() => {}}
        />,
      );
    });
  };

  const ordemNaTela = () =>
    Array.from(hospedeiro.querySelectorAll("[data-produto]")).map((card) =>
      card.getAttribute("data-produto"),
    );

  describe("relevância", () => {
    it("na busca, quem tem o termo no NOME vem antes de quem só o cita na descrição", async () => {
      await render({ searchQuery: "bolsa" });
      // "Bolsa Preta" (nome começa com o termo) antes da "Camisa Nova" (só a
      // descrição cita); a "Bolsa Vermelha" esgotada continua por último.
      expect(ordemNaTela()).toEqual(["bolsa", "camisa", "bolsa-esgotada"]);
    });

    it("sem busca, 'Relevância' segue a ordem do catálogo (com estoque primeiro)", async () => {
      await render();
      expect(ordemNaTela()).toEqual([
        "camisa",
        "bolsa",
        "camiseta",
        "bolsa-esgotada",
      ]);
    });

    it("escolhida a ordem por preço, o preço manda e a relevância não interfere", async () => {
      await render({ searchQuery: "bolsa", sortBy: "price-asc" });
      // Precos iguais: vence a data mais nova, nao a pontuacao de relevancia.
      expect(ordemNaTela()).toEqual(["camisa", "bolsa", "bolsa-esgotada"]);
    });
  });

  describe("categoria marcada", () => {
    it("começar uma busca com 'Bolsas' marcada devolve a categoria para 'Todas'", async () => {
      const trocar = vi.fn();
      await render({ selectedCategory: "Bolsas", onCategoryChange: trocar });
      expect(trocar).not.toHaveBeenCalled();

      await render({
        selectedCategory: "Bolsas",
        searchQuery: "camiseta",
        onCategoryChange: trocar,
      });

      expect(trocar).toHaveBeenCalledTimes(1);
      expect(trocar).toHaveBeenCalledWith("Todas");
    });

    it("sem categoria marcada, buscar não mexe na categoria", async () => {
      const trocar = vi.fn();
      await render({ onCategoryChange: trocar });
      await render({ searchQuery: "camiseta", onCategoryChange: trocar });
      expect(trocar).not.toHaveBeenCalled();
    });

    it("tocar numa categoria DEPOIS de buscar é escolha dela: não é desfeito", async () => {
      const trocar = vi.fn();
      await render({ searchQuery: "bolsa", onCategoryChange: trocar });
      await render({
        searchQuery: "bolsa",
        selectedCategory: "Bolsas",
        onCategoryChange: trocar,
      });
      expect(trocar).not.toHaveBeenCalled();
      // A lista respeita a categoria que ela mesma escolheu.
      expect(ordemNaTela()).toEqual(["bolsa", "bolsa-esgotada"]);
    });
  });
});
