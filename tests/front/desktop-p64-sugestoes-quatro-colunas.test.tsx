// @vitest-environment jsdom
//
// P64 (D3): o bloco "Alguns produtos da loja" de Favoritos e de Busca mostra
// SEMPRE 4 produtos, mas a grade compartilhada vira 5 colunas a partir de xl
// (1280): sobrava um furo de ~280 px à direita. Nesses dois pontos a grade
// passa a ter 4 colunas também em xl. A constante GRADE_DE_PRODUTOS_NO_COMPUTADOR
// NÃO muda (a Home, a lista de produtos e os resultados da Busca seguem em 5):
// o `xl:grid-cols-4` entra como argumento a mais do `cn`, e o tailwind-merge
// descarta o `xl:grid-cols-5` da constante só ali. Celular e tablet intactos.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";
import { classesDoCelular } from "./classes-do-celular";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = (id: string): Product => ({
  id,
  name: id,
  description: "",
  price: 100,
  images: [],
  category: "Vestidos",
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
});
const catalogo = vi.hoisted(() => ({ lista: [] as Product[] }));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo.lista }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: catalogo.lista,
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
    catalogoErro: false,
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
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
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string } }) => (
    <span data-testid="cartao">{product.id}</span>
  ),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: () => null,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const tokens = (el: Element) => el.className.split(/\s+/);

// A grade é irmã (seguinte) do bloco do título "Alguns produtos da ...".
function gradeDeSugestoes(host: HTMLElement): HTMLElement {
  const titulo = Array.from(host.querySelectorAll("h3")).find((h) =>
    h.textContent?.startsWith("Alguns produtos da"),
  );
  expect(titulo, "título das sugestões").toBeDefined();
  for (let el: Element | null = titulo!; el; el = el.parentElement) {
    const proximo = el.nextElementSibling;
    if (proximo?.classList.contains("grid")) return proximo as HTMLElement;
  }
  throw new Error("grade de sugestões não encontrada");
}

describe("P64 -- sugestões com 4 produtos usam 4 colunas em xl", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    catalogo.lista = ["a", "b", "c", "d", "e", "f"].map(produto);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("Favoritos: 4 cartões, celular intacto, 4 colunas em xl", async () => {
    const { FavoritesView } = await import("@/views/customer/FavoritesView");
    await act(async () => {
      raiz.render(
        <FavoritesView
          favorites={[]}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    const grade = gradeDeSugestoes(host);
    expect(grade.querySelectorAll('[data-testid="cartao"]')).toHaveLength(4);
    expect(classesDoCelular(grade.className)).toBe(
      "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3",
    );
    expect(tokens(grade)).toContain("lg:grid-cols-4");
    expect(tokens(grade)).toContain("xl:grid-cols-4");
    expect(tokens(grade)).not.toContain("xl:grid-cols-5");
  });

  it("Busca vazia: 4 cartões, celular intacto, 4 colunas em xl", async () => {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery="zzzzqq"
        />,
      );
    });
    const grade = gradeDeSugestoes(host);
    expect(grade.querySelectorAll('[data-testid="cartao"]')).toHaveLength(4);
    expect(classesDoCelular(grade.className)).toBe(
      "grid grid-cols-2 gap-6 md:grid-cols-3",
    );
    expect(tokens(grade)).toContain("lg:grid-cols-4");
    expect(tokens(grade)).toContain("xl:grid-cols-4");
    expect(tokens(grade)).not.toContain("xl:grid-cols-5");
  });

  it("controle: os resultados da Busca (lista longa) seguem em 5 colunas em xl", async () => {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(<SearchView onNavigate={() => {}} onBack={() => {}} />);
    });
    const grades = Array.from(host.querySelectorAll("div.grid")).filter((g) =>
      g.querySelector('[data-testid="cartao"]'),
    );
    expect(grades).toHaveLength(1);
    expect(tokens(grades[0])).toContain("xl:grid-cols-5");
    expect(tokens(grades[0])).not.toContain("xl:grid-cols-4");
  });
});
