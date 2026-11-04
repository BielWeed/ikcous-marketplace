// @vitest-environment jsdom
//
// ORDENAÇÃO ALTERADA CONTA COMO FILTRO (rodada 5, achado 4).
//
// Mudar só a ordenação ("Maior Preço") não aparecia no botão "Filtros" e o
// "Limpar Tudo" do painel não existia — embora ele zere a ordenação. Agora a
// ordenação diferente do padrão ("Mais Novos") conta no número e libera o
// "Limpar Tudo", que volta tudo ao padrão.
import {
  act,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Category, Product } from "@/types";
import { SearchView } from "@/views/customer/SearchView";

function produto(id: string, nome: string, categoria: string): Product {
  return {
    id,
    name: nome,
    description: "",
    price: 100,
    images: [],
    category: categoria,
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

let mockedProducts: Product[] = [];
let mockedCategories: Category[] = [];

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0, enableReviews: false },
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: mockedProducts,
    getFreeShippingEligibleProducts: () => [],
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: mockedCategories, isLoading: false }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

// Mesmo dublê de Sheet de limpar-tudo-limpa-de-verdade.test.tsx (o Radix real
// precisa de PointerEvent/ResizeObserver que o jsdom daqui não tem).
const SheetOpenContext = createContext<{
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}>({ open: false });
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) => (
    <SheetOpenContext.Provider value={{ open, onOpenChange }}>
      {children}
    </SheetOpenContext.Provider>
  ),
  SheetTrigger: ({ children }: { asChild?: boolean; children: ReactNode }) => {
    const { onOpenChange } = useContext(SheetOpenContext);
    if (!isValidElement(children)) return children;
    return cloneElement(children as ReactElement<{ onClick?: () => void }>, {
      onClick: () => onOpenChange?.(true),
    });
  },
  SheetContent: ({ children }: { children: ReactNode }) => {
    const { open } = useContext(SheetOpenContext);
    return open ? <div>{children}</div> : null;
  },
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchView — a ordenação conta como filtro e dá para limpar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockedProducts = [
      produto("p1", "Vestido Floral", "Vestidos"),
      produto("p2", "Sandália Rasa", "Sandálias"),
    ];
    mockedCategories = [];
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

  const botoes = () => Array.from(hospedeiro.querySelectorAll("button"));
  const botaoFiltros = () =>
    botoes().find((b) => b.textContent?.startsWith("Filtros")) as HTMLElement;
  const botaoPorTexto = (texto: string) =>
    botoes().find((b) => b.textContent === texto) as HTMLElement | undefined;

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function abrir() {
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery=""
          onQueryChange={() => {}}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await clicar(botaoFiltros());
  }

  it("ordenação no padrão: sem número no botão e sem 'Limpar Tudo'", async () => {
    await abrir();
    expect(botaoFiltros().textContent).not.toContain("(");
    expect(botaoPorTexto("Limpar Tudo")).toBeUndefined();
  });

  it("escolher 'Maior Preço' mostra (1) em Filtros e libera o 'Limpar Tudo'", async () => {
    await abrir();
    await clicar(botaoPorTexto("Maior Preço") as HTMLElement);
    expect(botaoFiltros().textContent).toContain("(1)");
    expect(botaoPorTexto("Limpar Tudo")).toBeDefined();
  });

  it("'Limpar Tudo' devolve a ordenação ao padrão e some", async () => {
    await abrir();
    await clicar(botaoPorTexto("Maior Preço") as HTMLElement);
    await clicar(botaoPorTexto("Limpar Tudo") as HTMLElement);
    expect(botaoFiltros().textContent).not.toContain("(");
    expect(botaoPorTexto("Limpar Tudo")).toBeUndefined();
    expect(botaoPorTexto("Mais Novos")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("categoria + ordenação somam (2)", async () => {
    await abrir();
    await clicar(botaoPorTexto("Vestidos") as HTMLElement);
    await clicar(botaoPorTexto("Alfabética") as HTMLElement);
    expect(botaoFiltros().textContent).toContain("(2)");
  });

  it("voltar a 'Mais Novos' à mão tira a contagem", async () => {
    await abrir();
    await clicar(botaoPorTexto("Menor Preço") as HTMLElement);
    expect(botaoFiltros().textContent).toContain("(1)");
    await clicar(botaoPorTexto("Mais Novos") as HTMLElement);
    expect(botaoFiltros().textContent).not.toContain("(");
  });
});
