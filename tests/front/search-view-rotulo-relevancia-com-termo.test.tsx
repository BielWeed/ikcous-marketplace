// @vitest-environment jsdom
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

import { SearchView } from "@/views/customer/SearchView";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 10, freeShippingMin: 0, enableReviews: false },
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
    getFreeShippingEligibleProducts: () => [],
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

// Mesmo dublê do teste de ordenação: abre a folha sem APIs ausentes do jsdom.
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
  SheetTrigger: ({ children }: { children: ReactNode }) => {
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

describe("SearchView — rótulo da ordenação padrão acompanha o termo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  const botoes = () => Array.from(hospedeiro.querySelectorAll("button"));
  const botaoPorTexto = (texto: string) =>
    botoes().find((botao) => botao.textContent === texto);
  const botaoFiltros = () =>
    botoes().find((botao) => botao.textContent?.startsWith("Filtros"));

  async function clicar(botao: HTMLButtonElement | undefined) {
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  async function abrir(termo: string) {
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery={termo}
          onQueryChange={() => {}}
        />,
      );
    });
    await clicar(botaoFiltros());
  }

  it("sem termo (inclusive só espaços) mostra Mais Novos", async () => {
    await abrir("   ");
    expect(botaoPorTexto("Mais Novos")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(botaoPorTexto("Relevância")).toBeUndefined();
  });

  it("com termo mostra Relevância e não mostra Mais Novos", async () => {
    await abrir("vestido");
    expect(botaoPorTexto("Relevância")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(botaoPorTexto("Mais Novos")).toBeUndefined();
    expect(botaoFiltros()?.textContent).not.toContain("(");
  });

  it("com termo e preço escolhido mantém as opções e conta o filtro", async () => {
    await abrir("vestido");
    await clicar(botaoPorTexto("Menor Preço"));
    for (const texto of [
      "Menor Preço",
      "Maior Preço",
      "Relevância",
      "Alfabética",
    ]) {
      expect(botaoPorTexto(texto)).toBeDefined();
    }
    expect(botaoPorTexto("Mais Novos")).toBeUndefined();
    expect(botaoPorTexto("Menor Preço")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(botaoPorTexto("Relevância")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(botaoFiltros()?.textContent).toContain("(1)");
    await clicar(botaoPorTexto("Relevância"));
    expect(botaoPorTexto("Relevância")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(botaoFiltros()?.textContent).not.toContain("(");
  });
});
