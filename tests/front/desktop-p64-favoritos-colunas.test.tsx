// @vitest-environment jsdom
//
// P64 (D1): em Favoritos, cada categoria ocupava uma linha com só metade da
// largura (600 px em 1280, 680 em 1920; mais de 600 px de vazio à direita). No
// computador as categorias passam a se repartir em 2 colunas (`lg:columns-2`),
// cada categoria inteira numa coluna só (`lg:break-inside-avoid`) e a lista de
// cartões dentro dela vira 1 coluna. Só classes `lg:` acrescentadas: o celular
// (e o tablet) fica byte a byte como era -- os literais abaixo são CONGELADOS.
import { PaginaDoComputador } from "@/components/desktop/PaginaDoComputador";
import type { Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const loja = vi.hoisted(() => ({
  products: [] as Product[],
  config: { enableReviews: false },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ ...loja, loadingProducts: false, catalogoErro: false }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    erro: null,
    refresh: vi.fn(),
    pendingCount: 0,
    favoritosIndisponiveis: 0,
  }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: vi.fn(),
    prefetchImage: vi.fn(),
  }),
}));

const CATEGORIAS = ["Anéis", "Brincos", "Colares"];
const favoritos: Product[] = CATEGORIAS.map((categoria, i) => ({
  id: `produto-inventado-p64-${i}`,
  name: `Produto inventado ${i}`,
  price: 30,
  category: categoria,
  description: "",
  images: [],
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-11-15T00:00:00Z",
  variants: [],
}));

// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let container: HTMLDivElement;
beforeEach(() => {
  loja.products = favoritos;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() =>
    raiz.render(
      <PaginaDoComputador>
        <FavoritesView
          favorites={favoritos}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
        />
      </PaginaDoComputador>,
    ),
  );
});
afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const secoes = () =>
  Array.from(container.querySelectorAll<HTMLElement>("section[data-secao]"));
const tem = (el: Element, classe: string) => el.classList.contains(classe);

describe("P64 -- Favoritos reparte as categorias em 2 colunas no computador", () => {
  it("renderiza uma seção por categoria", () => {
    expect(secoes().map((s) => s.dataset.secao)).toEqual(CATEGORIAS);
  });

  it("a lista de categorias vira 2 colunas com folga, sem mexer no celular", () => {
    const lista = secoes()[0].parentElement!;
    expect(classesDoCelular(lista.className)).toBe("px-4");
    expect(tem(lista, "lg:px-0")).toBe(true);
    expect(tem(lista, "lg:columns-2")).toBe(true);
    expect(tem(lista, "lg:gap-x-10")).toBe(true);
  });

  it("cada categoria fica inteira numa coluna só, sem mexer no celular", () => {
    for (const secao of secoes()) {
      expect(classesDoCelular(secao.className)).toBe("scroll-mt-4 pt-5");
      expect(tem(secao, "lg:break-inside-avoid")).toBe(true);
    }
  });

  it("os cartões de cada categoria ficam em 1 coluna dentro da coluna da página", () => {
    for (const secao of secoes()) {
      const ul = secao.querySelector("ul")!;
      // A lista só é grade no computador: abaixo de 1024 não há classe nenhuma.
      expect(classesDoCelular(ul.className)).toBe("");
      expect(tem(ul, "lg:grid")).toBe(true);
      expect(tem(ul, "lg:grid-cols-1")).toBe(true);
      expect(tem(ul, "lg:grid-cols-2")).toBe(false);
      expect(tem(ul, "lg:gap-4")).toBe(true);
    }
  });
});
