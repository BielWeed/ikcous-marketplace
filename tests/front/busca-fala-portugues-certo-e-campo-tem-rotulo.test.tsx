// @vitest-environment jsdom
//
// Caça 4 (24/10/2026), achado V7 (pequenos da tela de busca): a contagem
// dizia "Encontramos 1 resultados" (plural errado), a ordenação trazia
// "Alfabetica" sem acento e o campo de busca não tinha nome para leitor de
// tela (só o placeholder, que some ao digitar).
//
// Mesma montagem de busca-nao-mostra-produto-pausado.test.tsx, com a folha
// "Refinar Busca" ABERTA (aqui o conteúdo dela precisa existir).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string): Product {
  return {
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
  };
}

let catalogo: Product[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
    catalogoErro: false,
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string } }) => (
    <span data-testid="resultado">{product.id}</span>
  ),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("SearchView — português certo e campo com nome (V7)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarBusca() {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(<SearchView onNavigate={() => {}} onBack={() => {}} />);
    });
  }

  it("um resultado: 'Encontramos 1 resultado' (singular)", async () => {
    catalogo = [produto("a")];
    await renderizarBusca();
    expect(hospedeiro.textContent).toMatch(/Encontramos 1 resultado(?!s)/);
  });

  it("dois resultados: 'Encontramos 2 resultados' (plural)", async () => {
    catalogo = [produto("a"), produto("b")];
    await renderizarBusca();
    expect(hospedeiro.textContent).toContain("Encontramos 2 resultados");
  });

  it("a ordenação diz 'Alfabética', com acento", async () => {
    catalogo = [produto("a")];
    await renderizarBusca();
    expect(hospedeiro.textContent).toContain("Alfabética");
    expect(hospedeiro.textContent).not.toContain("Alfabetica");
  });

  it("o campo de busca tem nome para leitor de tela", async () => {
    catalogo = [produto("a")];
    await renderizarBusca();
    const campo = hospedeiro.querySelector<HTMLInputElement>("#search-input");
    expect(campo?.getAttribute("aria-label")).toBe("Buscar produtos");
  });
});
