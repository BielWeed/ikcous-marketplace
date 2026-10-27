// @vitest-environment jsdom
//
// VOLTAR DO CELULAR COM A FOLHA DE FILTROS DA BUSCA ABERTA. O defeito: no
// Android, com "Refinar Busca" aberto (categoria e ordenação escolhidas), o
// Voltar tirava a cliente da busca inteira e os filtros se perdiam. Agora o
// Voltar fecha só a folha: a busca continua montada, com o termo e os filtros
// escolhidos, e nenhuma entrada de histórico sobra (fechar pelo "Aplicar
// Filtros" também devolve a entrada, sem a tela recuar).
//
// Histórico REAL do jsdom e um "App" simulado que só navega quando a tela do
// histórico muda. O Sheet é o mesmo dublê de search-view-caixa-e-categorias
// (o Radix real precisa de PointerEvent/ResizeObserver que o jsdom daqui não
// tem); o que se prova é o histórico, que não depende do Radix.
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

import type { Product } from "@/types";
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

const mockedProducts: Product[] = [
  produto("p1", "Vestido Floral", "Vestidos"),
  produto("p2", "Sandália Rasa", "Sandálias"),
];

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
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

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
    return open ? <div data-testid="folha-filtros">{children}</div> : null;
  },
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("SearchView — o Voltar do celular fecha só a folha de filtros", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let navegacoesDoApp: string[];
  const ouvintes: Array<(e: PopStateEvent) => void> = [];
  const onBack = vi.fn();

  const telaDoHistorico = () =>
    `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

  beforeEach(() => {
    onBack.mockReset();
    globalThis.history.replaceState({ view: "home" }, "", "/");
    globalThis.history.pushState({ view: "search" }, "", "/search");
    navegacoesDoApp = [];
    let telaMostrada = telaDoHistorico();
    const ouvinte = () => {
      const alvo = telaDoHistorico();
      if (alvo === telaMostrada) return;
      telaMostrada = alvo;
      navegacoesDoApp.push(alvo);
    };
    ouvintes.push(ouvinte);
    globalThis.addEventListener("popstate", ouvinte);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    for (const o of ouvintes.splice(0)) {
      globalThis.removeEventListener("popstate", o);
    }
  });

  async function abrirABusca() {
    await act(async () => {
      raiz.render(
        <SearchView onNavigate={() => {}} onBack={onBack} initialQuery="" />,
      );
    });
    await act(async () => {
      await esperar(20);
    });
  }

  const botoes = () => Array.from(hospedeiro.querySelectorAll("button"));
  const botaoFiltros = () =>
    botoes().find((b) => b.textContent?.startsWith("Filtros")) as HTMLElement;
  const folha = () =>
    hospedeiro.querySelector<HTMLElement>('[data-testid="folha-filtros"]');
  const botaoNaFolha = (texto: string) =>
    Array.from(folha()?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent === texto,
    ) as HTMLElement;

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Dá tempo ao `history.back()` que o fechamento pede e ao retorno engolido.
    await act(async () => {
      await esperar(120);
    });
  }

  async function apertarVoltar() {
    await act(async () => {
      globalThis.history.back();
      await esperar(60);
    });
    await act(async () => {
      await esperar(120);
    });
  }

  it("abrir a folha empurra UMA entrada com o mesmo endereço da busca", async () => {
    await abrirABusca();
    const antes = globalThis.history.length;
    await clicar(botaoFiltros());
    expect(folha()).not.toBeNull();
    expect(globalThis.history.length).toBe(antes + 1);
    expect(globalThis.location.pathname).toBe("/search");
    expect(globalThis.history.state).toMatchObject({
      view: "search",
      folhaDePolitica: true,
    });
  });

  it("Voltar: a folha fecha, a busca continua com o filtro escolhido e o App não troca de tela", async () => {
    await abrirABusca();
    await clicar(botaoFiltros());
    await clicar(botaoNaFolha("Vestidos"));
    expect(botaoFiltros().textContent).toContain("(1)");

    await apertarVoltar();

    expect(folha()).toBeNull();
    expect(botaoFiltros().textContent).toContain("(1)");
    expect(navegacoesDoApp).toEqual([]);
    expect(onBack).not.toHaveBeenCalled();
    expect(globalThis.history.state).toEqual({ view: "search" });
  });

  it("depois de fechar pelo Voltar, o Voltar seguinte é do roteador", async () => {
    await abrirABusca();
    await clicar(botaoFiltros());
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual([]);
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });

  it("'Aplicar Filtros' consome a entrada: a tela não recua e não sobra entrada", async () => {
    await abrirABusca();
    await clicar(botaoFiltros());
    await clicar(botaoNaFolha("Aplicar Filtros"));

    expect(folha()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual({ view: "search" });
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });

  it("abrir, fechar e abrir de novo: cada abertura tem a sua entrada", async () => {
    await abrirABusca();
    for (let i = 0; i < 2; i++) {
      await clicar(botaoFiltros());
      expect(folha()).not.toBeNull();
      await apertarVoltar();
      expect(folha()).toBeNull();
    }
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual({ view: "search" });
  });
});
