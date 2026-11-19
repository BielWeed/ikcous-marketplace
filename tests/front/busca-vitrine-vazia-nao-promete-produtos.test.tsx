// @vitest-environment jsdom
//
// Loja sem produto à venda: a busca dizia "Que tal dar uma olhada em alguns
// produtos da loja?" e abria o bloco "Sugestões / Alguns produtos da <Loja>"
// com a grade VAZIA. Os Favoritos já escondem esse bloco quando não há
// sugestão; a busca ficou para trás (caça 12-B #4).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// limpar-tudo-limpa-de-verdade.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(p: Partial<Product> & Pick<Product, "id">): Product {
  return {
    name: p.id,
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
    ...p,
  };
}

let catalogo: Product[] = [];
let catalogoErro = false;
let loading = false;
const fetchProducts = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
    catalogoErro,
    loadingProducts: loading,
    fetchProducts,
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
// Painel "Refinar Busca" fechado: o Radix real pede APIs que o jsdom não tem
// (ver limpar-tudo-limpa-de-verdade.test.tsx). Os chips de categoria medidos
// aqui ficam FORA do painel, na fileira de filtros rápidos.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: () => null,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("SearchView — vitrine vazia não promete produtos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    catalogoErro = false;
    loading = false;
    fetchProducts.mockReset();
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

  async function renderizarBusca(initialQuery?: string) {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery={initialQuery}
        />,
      );
    });
    return hospedeiro;
  }

  it("loja sem produto à venda: nada de 'Alguns produtos da' nem de 'dar uma olhada em alguns produtos'", async () => {
    catalogo = [];
    const host = await renderizarBusca();
    expect(host.textContent).not.toContain("Alguns produtos da");
    expect(host.textContent).not.toContain("Sugestões");
    expect(host.textContent).not.toContain("alguns produtos da loja");
  });

  it("só com produto pausado a loja também está sem vitrine: sem sugestões", async () => {
    catalogo = [produto({ id: "pausado", isActive: false })];
    const host = await renderizarBusca();
    expect(host.textContent).not.toContain("Alguns produtos da");
  });

  // Quem abre a busca numa loja sem produto não buscou nada nem ligou filtro:
  // "Ué, nenhum resultado?" e "Limpar Tudo" mentem (não há o que limpar). A
  // Home já separa os dois casos ("Em breve novidades por aqui").
  it("loja sem produto à venda: diz que a loja ainda não tem produtos, sem 'nenhum resultado' nem 'Limpar Tudo'", async () => {
    catalogo = [];
    const host = await renderizarBusca();
    expect(host.textContent).toContain("A loja ainda não tem produtos");
    expect(host.textContent).toContain("Volte em breve.");
    expect(host.textContent).not.toContain("Ué, nenhum resultado?");
    expect(host.textContent).not.toContain("com esses filtros");
    const botoes = Array.from(host.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(botoes).not.toContain("Limpar Tudo");
  });

  it("todos os produtos pausados contam como loja sem produto à venda", async () => {
    catalogo = [produto({ id: "pausado", isActive: false })];
    const host = await renderizarBusca();
    expect(host.textContent).toContain("A loja ainda não tem produtos");
    expect(host.textContent).not.toContain("Ué, nenhum resultado?");
  });

  it("busca sem resultado com catálogo só de esgotados: não sugere produtos e mantém Limpar Tudo", async () => {
    catalogo = [produto({ id: "vestido", name: "Vestido", stock: 0 })];
    await renderizarBusca("zzzz-nao-existe");
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 400));
    });

    expect(hospedeiro.textContent).toContain("Ué, nenhum resultado?");
    expect(hospedeiro.textContent).toContain("Limpar Tudo");
    expect(hospedeiro.textContent).not.toContain("alguns produtos da loja");
    expect(hospedeiro.textContent).not.toContain("Sugestões");
    expect(hospedeiro.querySelector('[data-testid="resultado"]')).toBeNull();
  });

  it("produto ativo esgotado ainda aparece quando corresponde à busca", async () => {
    catalogo = [produto({ id: "vestido", name: "Vestido", stock: 0 })];
    await renderizarBusca("Vestido");
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 400));
    });

    expect(
      hospedeiro.querySelector('[data-testid="resultado"]')?.textContent,
    ).toBe("vestido");
    expect(hospedeiro.textContent).not.toContain("Sugestões");
  });

  it("controle: com produto à venda e busca sem resultado, mantém 'Ué, nenhum resultado?' e 'Limpar Tudo'", async () => {
    catalogo = [produto({ id: "vestido", name: "Vestido" })];
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery="zzzz-nao-existe"
        />,
      );
    });
    // O termo passa por um debounce de 300 ms antes de filtrar a lista.
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 400));
    });
    expect(hospedeiro.textContent).toContain("Ué, nenhum resultado?");
    expect(hospedeiro.textContent).not.toContain(
      "A loja ainda não tem produtos",
    );
    const botoes = Array.from(hospedeiro.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(botoes).toContain("Limpar Tudo");
  });
});
