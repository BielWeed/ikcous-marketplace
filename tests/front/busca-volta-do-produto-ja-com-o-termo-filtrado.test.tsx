// @vitest-environment jsdom
//
// Ao voltar do produto para a tela /search, a lista aparecia primeiro SEM o
// filtro do termo ("Encontramos N resultados" contando a loja inteira) e só
// ~300 ms depois encolhia para os poucos resultados. O termo guardado pelo App
// (`initialQuery`) só entrava num efeito depois do primeiro desenho, e o
// atraso de digitação (debounce) o segurava mais 300 ms. Agora o termo guardado
// vale desde o primeiro desenho: nada de esperar relógio nenhum.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag de teste interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(p: Partial<Product> & Pick<Product, "id">): Product {
  return {
    name: p.id,
    description: "",
    price: 100,
    images: [],
    category: "Geral",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...p,
  };
}

const catalogo: Product[] = [
  produto({ id: "bolsa-um", name: "Bolsa Um" }),
  produto({ id: "bolsa-dois", name: "Bolsa Dois" }),
  produto({ id: "vestido-um", name: "Vestido Um" }),
  produto({ id: "vestido-dois", name: "Vestido Dois" }),
];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
    loadingProducts: false,
    catalogoErro: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
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
  SheetContent: () => null,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("SearchView: voltar do produto já abre filtrada pelo termo", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  const idsNaTela = () =>
    Array.from(host.querySelectorAll('[data-testid="resultado"]')).map(
      (el) => el.textContent,
    );

  it("no primeiro desenho só aparecem os achados do termo, e o contador conta só eles", async () => {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery="bolsa"
        />,
      );
    });
    // Sem esperar nenhum relógio: é o desenho que a cliente vê ao voltar.
    expect(idsNaTela().sort()).toEqual(["bolsa-dois", "bolsa-um"]);
    expect(host.textContent).toContain("Encontramos 2 resultados");
    expect(host.textContent).not.toContain("Encontramos 4 resultados");
    expect(host.querySelector<HTMLInputElement>("#search-input")?.value).toBe(
      "bolsa",
    );
  });

  it("controle: sem termo guardado a lista é a loja inteira", async () => {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(<SearchView onNavigate={() => {}} onBack={() => {}} />);
    });
    expect(idsNaTela()).toHaveLength(4);
    expect(host.textContent).toContain("Encontramos 4 resultados");
  });
});
