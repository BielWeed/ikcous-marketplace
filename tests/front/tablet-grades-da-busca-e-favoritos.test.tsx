// @vitest-environment jsdom
//
// Loja do cliente em TABLET (768–1023 px). Defeito medido num Chromium de
// verdade, que não aparece no celular (390) nem no computador (>= 1024):
//
// (B) Busca (resultados e sugestões) e sugestões dos Favoritos: a grade
//     ficava com 2 colunas ate 1023 px, e o cartão chegava a ~482x602. A Home
//     já usa `md:grid-cols-3`; estas três grades passam a usar também.
//
// Abaixo de 768 px o className renderizado é o mesmo de antes: os literais
// abaixo são a lista congelada do celular, escrita à mão (nunca lida do
// histórico do git -- o CI clona só o último commit).
import type { Product } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: catalogo,
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    loading: false,
    erro: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      shippingFee: 10,
      freeShippingMin: 0,
      storeName: "Loja de teste",
    },
    isLoaded: true,
    products: catalogo,
    catalogoErro: false,
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
// O cartão real não entra: o que se mede aqui é a GRADE que o contém.
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { product: { id: string } }) => (
    <span data-testid="cartao">{product.id}</span>
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

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function umProduto(id: string): Product {
  return {
    id,
    name: `Blusa ${id}`,
    description: "Descrição",
    price: 100,
    images: ["/foto-1.png"],
    category: "Roupas",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-09-28T12:00:00Z",
  };
}
const catalogo: Product[] = ["a", "b", "c", "d"].map(umProduto);

/** Classes que valem ABAIXO de 768 px: tira tudo que liga em md/lg/xl/2xl. */
function abaixoDe768(className: string): string {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !["md", "lg", "xl", "2xl"].includes(t.split(":")[0]))
    .join(" ");
}
const tokens = (className: string) => className.split(/\s+/).filter(Boolean);

describe("Tablet — grades de produtos da Busca e dos Favoritos", () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  function gradeDosCartoes(): HTMLElement[] {
    const pais = new Set<HTMLElement>();
    for (const c of host.querySelectorAll("[data-testid='cartao']")) {
      // O cartão fica dentro de um item da grade; a grade é o `grid` acima.
      const grade = c.closest<HTMLElement>(".grid");
      if (grade) pais.add(grade);
    }
    return [...pais];
  }

  it("Busca, sugestões (sem termo): 2 colunas no celular, 3 no tablet, 4/5 no PC", async () => {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      root.render(<SearchView onNavigate={() => {}} onBack={() => {}} />);
    });
    const grades = gradeDosCartoes();
    expect(grades).toHaveLength(1);
    const t = tokens(grades[0].className);
    expect(abaixoDe768(grades[0].className)).toBe("grid grid-cols-2 gap-6");
    expect(t).toContain("md:grid-cols-3");
    expect(t).toContain("lg:grid-cols-4");
    expect(t).toContain("xl:grid-cols-5");
  });

  it("Busca, resultados (com termo): 2 colunas no celular, 3 no tablet, 4/5 no PC", async () => {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      root.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery="Blusa"
        />,
      );
    });
    const grades = gradeDosCartoes();
    expect(grades).toHaveLength(1);
    const t = tokens(grades[0].className);
    expect(abaixoDe768(grades[0].className)).toBe("grid grid-cols-2 gap-6");
    expect(t).toContain("md:grid-cols-3");
    expect(t).toContain("lg:grid-cols-4");
    expect(t).toContain("xl:grid-cols-5");
  });

  it("Favoritos, sugestões: 2 colunas no celular, 3 no tablet, 4 no PC", async () => {
    const { FavoritesView } = await import("@/views/customer/FavoritesView");
    await act(async () => {
      root.render(
        <FavoritesView
          favorites={[]}
          onToggleFavorite={vi.fn()}
          onProductClick={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    const grades = gradeDosCartoes();
    expect(grades).toHaveLength(1);
    const t = tokens(grades[0].className);
    expect(abaixoDe768(grades[0].className)).toBe(
      "grid grid-cols-2 gap-3 sm:gap-4",
    );
    expect(t).toContain("md:grid-cols-3");
    expect(t).toContain("lg:grid-cols-4");
    // P64: são só 4 sugestões; em xl a grade fica em 4 colunas (sem furo à direita).
    expect(t).toContain("xl:grid-cols-4");
    expect(t).not.toContain("xl:grid-cols-5");
  });
});
