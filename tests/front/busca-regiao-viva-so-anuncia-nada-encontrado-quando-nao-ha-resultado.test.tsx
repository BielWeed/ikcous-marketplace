// @vitest-environment jsdom
//
// A tela /search tem uma regiao viva SEMPRE montada (`<p role="status"
// className="sr-only">`) que o leitor de tela le quando o texto muda. Ela so
// pode dizer "Nenhum resultado para essa busca." quando de fato NAO ha
// resultado: com produtos na tela, anunciar "nenhum resultado" mentiria so para
// quem nao enxerga. (Caca por mutacao, 24/11/2026: tirar a condicao "lista
// vazia" dessa regiao passava em toda a suite -- nenhum teste olhava o texto
// dela COM resultados.)
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// busca-vitrine-vazia-nao-promete-produtos.test.tsx.
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
const fetchProducts = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, shippingFee: 10, freeShippingMin: 0 },
    catalogoErro,
    loadingProducts: false,
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
// Painel "Refinar Busca" fechado: o Radix real pede APIs que o jsdom não tem.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: () => null,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("SearchView — a região viva só anuncia 'nada encontrado' sem resultado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    catalogoErro = false;
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
    // O termo vindo de fora entra num efeito e a lista passa pelo debounce.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    return hospedeiro.querySelector('p[role="status"].sr-only')?.textContent;
  }

  it("com resultado na tela a região fica em silêncio", async () => {
    catalogo = [produto({ id: "vestido-azul" })];
    const aviso = await renderizarBusca("vestido");

    expect(hospedeiro.textContent).toContain("Encontramos 1 resultado");
    expect(aviso).toBe("");
  });

  it("sem resultado para o termo: anuncia 'Nenhum resultado para essa busca.'", async () => {
    catalogo = [produto({ id: "vestido-azul" })];
    const aviso = await renderizarBusca("sapato");

    expect(hospedeiro.textContent).toContain("Ué, nenhum resultado?");
    expect(aviso).toBe("Nenhum resultado para essa busca.");
  });

  it("loja sem produto à venda: anuncia que a loja ainda não tem produtos", async () => {
    catalogo = [];
    const aviso = await renderizarBusca();

    expect(aviso).toBe("A loja ainda não tem produtos.");
  });

  it("catálogo que falhou e lista vazia: a região fica em silêncio (o erro já tem o seu alerta)", async () => {
    catalogoErro = true;
    catalogo = [];
    const aviso = await renderizarBusca("vestido");

    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    expect(aviso).toBe("");
  });
});
