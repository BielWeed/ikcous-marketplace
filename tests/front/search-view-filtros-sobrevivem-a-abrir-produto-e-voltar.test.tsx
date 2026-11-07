// @vitest-environment jsdom
//
// Achado 1 do lote r56-d (06/11/2026): categoria, ordenação e faixa de preço da
// busca (/search) se perdiam ao abrir um produto e voltar.
//
// A tela só existe enquanto a rota é "search": ao abrir o produto ela é
// desmontada, e ao voltar remontava com "Todas" e "Mais Novos" — só o termo
// digitado voltava (o App o devolve em `initialQuery`). A cliente refazia o
// filtro a cada produto que abria para comparar.
//
// Agora o App guarda os filtros fora da tela (como a Home já faz) e os devolve
// em `filtrosIniciais`; a tela avisa cada mudança em `aoMudarFiltros`. O teste
// faz o papel do App com uma variável do lado de fora: monta, filtra, desmonta
// (o produto abre), monta de novo (a cliente voltou).
//
// Andaime: o MESMO de search-view-ordenacao-conta-como-filtro.test.tsx.
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

import type { FiltrosDaBusca } from "@/hooks/useSearch";
import type { Category, Product } from "@/types";
import { SearchView } from "@/views/customer/SearchView";

function produto(
  id: string,
  nome: string,
  categoria: string,
  preco = 100,
): Product {
  return {
    id,
    name: nome,
    description: "",
    price: preco,
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

// Mesmo dublê de Sheet de search-view-ordenacao-conta-como-filtro.test.tsx.
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

describe("SearchView — categoria, ordem e faixa de preço sobrevivem a abrir um produto e voltar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // O que o App guarda entre uma visita à tela e a outra.
  let lembrados: FiltrosDaBusca | null;

  beforeEach(() => {
    // A lista vazia mostra sugestões, cujos cards usam o observador de tela.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    mockedProducts = [
      produto("p1", "Vestido Floral", "Vestidos", 300),
      produto("p2", "Vestido Liso", "Vestidos", 100),
      produto("p3", "Sandália Rasa", "Sandálias", 50),
    ];
    mockedCategories = [];
    lembrados = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
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

  const esperar = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  };

  // `termo` é o que o App devolve em `initialQuery`.
  async function montar(termo = "") {
    await act(async () => {
      raiz.render(
        <SearchView
          onNavigate={() => {}}
          onBack={() => {}}
          initialQuery={termo}
          onQueryChange={() => {}}
          filtrosIniciais={lembrados ?? undefined}
          aoMudarFiltros={(filtros: FiltrosDaBusca) => {
            lembrados = filtros;
          }}
        />,
      );
    });
    await esperar();
  }

  // Abrir o produto desmonta a tela; voltar monta outra do zero.
  async function abrirProdutoEVoltar(termo = "") {
    await act(async () => {
      raiz.render(<div />);
    });
    await esperar();
    await montar(termo);
  }

  const textoDaTela = () => hospedeiro.textContent ?? "";

  it("categoria e ordem escolhidas voltam depois de abrir um produto: botão (2), ordem marcada e lista filtrada", async () => {
    await montar();
    await clicar(botaoFiltros());
    await clicar(botaoPorTexto("Vestidos") as HTMLElement);
    await clicar(botaoPorTexto("Menor Preço") as HTMLElement);
    expect(botaoFiltros().textContent).toContain("(2)");

    await abrirProdutoEVoltar();

    expect(botaoFiltros().textContent).toContain("(2)");
    await clicar(botaoFiltros());
    expect(botaoPorTexto("Menor Preço")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(botaoPorTexto("Mais Novos")?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    // A lista continua refinada: sem a Sandália, e o Vestido Liso (R$ 100) antes
    // do Floral (R$ 300).
    const tela = textoDaTela();
    expect(tela).not.toContain("Sandália Rasa");
    expect(tela.indexOf("Vestido Liso")).toBeGreaterThanOrEqual(0);
    expect(tela.indexOf("Vestido Liso")).toBeLessThan(
      tela.indexOf("Vestido Floral"),
    );
  });

  it("'Limpar Tudo' zera de verdade: voltar depois dele não ressuscita o filtro", async () => {
    await montar();
    await clicar(botaoFiltros());
    await clicar(botaoPorTexto("Vestidos") as HTMLElement);
    await clicar(botaoPorTexto("Maior Preço") as HTMLElement);
    await clicar(botaoPorTexto("Limpar Tudo") as HTMLElement);
    expect(botaoFiltros().textContent).not.toContain("(");

    await abrirProdutoEVoltar();

    expect(botaoFiltros().textContent).not.toContain("(");
    expect(lembrados).toEqual({
      category: "Todas",
      minPrice: "",
      maxPrice: "",
      sort: "newest",
    });
  });

  it("LIMITE: o topo esvaziar o termo continua zerando os filtros guardados", async () => {
    lembrados = {
      category: "Vestidos",
      minPrice: "",
      maxPrice: "",
      sort: "price_asc",
    };
    await montar("vestido");
    expect(botaoFiltros().textContent).toContain("(2)");

    // O App devolve o termo vazio (a cliente apagou no topo).
    await montar("");

    expect(botaoFiltros().textContent).not.toContain("(");
    expect(lembrados?.category).toBe("Todas");
    expect(lembrados?.sort).toBe("newest");
  });

  it("LIMITE: sem nada guardado (primeira visita) a tela abre no padrão", async () => {
    await montar();
    expect(botaoFiltros().textContent).not.toContain("(");
  });

  it("LIMITE: categoria guardada que a loja não vende mais não esconde a lista sem aviso — o botão a conta e 'Limpar Tudo' a tira", async () => {
    lembrados = {
      category: "Categoria Que Sumiu",
      minPrice: "",
      maxPrice: "",
      sort: "newest",
    };
    await montar();
    await clicar(botaoFiltros());
    expect(botaoFiltros().textContent).toContain("(1)");
    await clicar(botaoPorTexto("Limpar Tudo") as HTMLElement);
    expect(botaoFiltros().textContent).not.toContain("(");
  });
});
