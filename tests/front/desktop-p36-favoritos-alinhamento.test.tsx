// @vitest-environment jsdom
import { PaginaDoComputador } from "@/components/desktop/PaginaDoComputador";
import type { Product } from "@/types";
import { FavoritesView } from "@/views/customer/FavoritesView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const produto: Product = {
  id: "produto-inventado-p36",
  name: "Produto inventado",
  price: 30,
  category: "Teste",
  description: "",
  images: [],
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-11-15T00:00:00Z",
  variants: [],
};

// @ts-expect-error flag interna do React usada pela suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let container: HTMLDivElement;
beforeEach(() => {
  loja.products = [produto];
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
});
afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function montar(estado: string) {
  act(() =>
    raiz.render(
      <PaginaDoComputador>
        <FavoritesView
          loading={estado === "carregando"}
          favorites={estado === "cheio" ? [produto] : []}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
        />
      </PaginaDoComputador>,
    ),
  );
}

function celular(elemento: Element) {
  return elemento.className
    .split(/\s+/)
    .filter((classe) => !/^(lg|xl|2xl):/.test(classe))
    .join(" ");
}

describe("P36 — Favoritos sem recuo lateral duplicado no computador", () => {
  // Remover lg:px-0 de qualquer cabeçalho ou da lista/esqueleto deve
  // reprovar: a casca já fornece os 32 px de margem no computador.
  it.each([
    ["carregando", "px-4 pb-4 pt-5"],
    ["vazio", "px-4 pb-4 pt-5"],
    [
      "cheio",
      "flex flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-5",
    ],
  ])(
    "alinha o título no estado %s sem mudar as classes do celular",
    (estado, base) => {
      montar(estado);
      const titulo = container.querySelector("h1")!;
      expect(titulo.textContent).toBe("Favoritos");
      const cabecalho = titulo.closest("header")!;
      expect(celular(cabecalho)).toBe(base);
      expect(cabecalho.classList.contains("lg:px-0")).toBe(true);
      expect(container.firstElementChild?.classList.contains("lg:px-8")).toBe(
        true,
      );
    },
  );

  it.each(["carregando", "vazio", "cheio"])(
    "alinha o primeiro cartão no estado %s sem mudar o celular",
    (estado) => {
      montar(estado);
      if (estado === "carregando") {
        const lista = container.querySelector(
          '[aria-label="Carregando favoritos"]',
        )!;
        expect(lista.children).toHaveLength(4);
        expect(celular(lista)).toBe("px-4");
        expect(lista.classList.contains("lg:px-0")).toBe(true);
      } else if (estado === "cheio") {
        const cartao = container.querySelector(".favorites-product-card")!;
        expect(cartao).not.toBeNull();
        const lista = cartao.closest("section")!.parentElement!;
        expect(celular(lista)).toBe("px-4");
        expect(lista.classList.contains("lg:px-0")).toBe(true);
      } else {
        const titulo = [...container.querySelectorAll("h3")].find(
          (el) => el.textContent === "Alguns produtos da loja",
        )!;
        const sugestoes = titulo.parentElement!.parentElement!;
        expect(sugestoes.querySelector("h3 button")).not.toBeNull();
        expect(celular(sugestoes)).toBe(
          "mx-4 mt-4 border-t border-border pt-6",
        );
        expect(sugestoes.classList.contains("lg:mx-0")).toBe(true);
      }
    },
  );

  // Revisão P36: atalhos de categoria (3+ categorias) e avisos também ficavam
  // 16 px à direita do título, porque continuavam com mx-4 sob a casca.
  it("alinha os atalhos de categoria ao título, sem mudar o celular", () => {
    const tres = ["Roupas", "Calçados", "Bolsas"].map((category, i) => ({
      ...produto,
      id: `produto-inventado-p36-${i}`,
      category,
    }));
    loja.products = tres;
    act(() =>
      raiz.render(
        <PaginaDoComputador>
          <FavoritesView
            loading={false}
            favorites={tres}
            onToggleFavorite={vi.fn()}
            onProductClick={vi.fn()}
            onNavigate={vi.fn()}
          />
        </PaginaDoComputador>,
      ),
    );
    const atalhos = container.querySelector(".favorites-atalhos")!;
    expect(atalhos).not.toBeNull();
    expect(celular(atalhos)).toBe(
      "favorites-atalhos mx-4 mb-1 flex min-w-0 gap-2 overflow-x-auto pb-1",
    );
    expect(atalhos.classList.contains("lg:mx-0")).toBe(true);
  });
});
