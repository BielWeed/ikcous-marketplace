// @vitest-environment jsdom
//
// Tela de busca (/search):
//  1. A caixa da página e a barra do topo eram dois termos que não se falavam:
//     digitar na página não chegava ao App. Agora a página avisa o App
//     (`onQueryChange`) e os dois são o MESMO termo; apagar o texto na própria
//     página não zera os filtros (só o topo esvaziar o termo zera, como antes).
//  2. Os filtros de categoria vinham dos produtos e mostravam até a categoria
//     que a lojista escondeu; a Home só mostra as ativas.
import {
  act,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
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

function categoria(nome: string, isActive: boolean): Category {
  return { id: nome, name: nome, slug: nome, isActive } as Category;
}

describe("SearchView — caixa da página e categorias dos filtros", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let mudarTermoDeFora: (termo: string) => void;
  const onQueryChange = vi.fn();

  /** Faz o papel do App: guarda o termo e o devolve como `initialQuery`. */
  function Pai({ inicial }: { inicial: string }) {
    const [termo, setTermo] = useState(inicial);
    useEffect(() => {
      mudarTermoDeFora = setTermo;
    }, []);
    return (
      <SearchView
        onNavigate={() => {}}
        onBack={() => {}}
        initialQuery={termo}
        onQueryChange={(t) => {
          onQueryChange(t);
          setTermo(t);
        }}
      />
    );
  }

  beforeEach(() => {
    onQueryChange.mockClear();
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

  async function abrir(inicial = "") {
    await act(async () => {
      raiz.render(<Pai inicial={inicial} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  const caixa = () =>
    hospedeiro.querySelector("#search-input") as HTMLInputElement;
  const botoes = () => Array.from(hospedeiro.querySelectorAll("button"));
  const botaoFiltros = () =>
    botoes().find((b) => b.textContent?.startsWith("Filtros")) as HTMLElement;

  async function digitar(texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(caixa(), texto);
      caixa().dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Passa a espera da caixa (300 ms) e a da lista.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 450));
    });
  }

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  const abrirFiltros = () => clicar(botaoFiltros());
  const botaoDaCategoria = (nome: string) =>
    botoes().find((b) => b.textContent === nome) as HTMLElement;
  // As categorias aparecem no painel "Refinar Busca" e nas pílulas do topo: a
  // lista sem repetição diz o que a cliente consegue escolher em qualquer um.
  const categoriasNoPainel = () => [
    ...new Set(
      botoes()
        .filter((b) => b.hasAttribute("aria-pressed"))
        .map((b) => b.textContent)
        .filter((t) => ["Todas", "Vestidos", "Sandálias"].includes(t ?? "")),
    ),
  ];

  describe("a caixa da página é o mesmo termo do App", () => {
    it("digitar na caixa da página avisa o App", async () => {
      await abrir();
      await digitar("vestido");
      expect(onQueryChange).toHaveBeenCalledWith("vestido");
      expect(caixa().value).toBe("vestido");
    });

    it("o termo que o topo muda aparece na caixa da página", async () => {
      await abrir("vestido");
      expect(caixa().value).toBe("vestido");
      await act(async () => {
        mudarTermoDeFora("sandalia");
      });
      expect(caixa().value).toBe("sandalia");
    });

    it("apagar o texto na própria página NÃO zera os filtros escolhidos", async () => {
      await abrir("vestido");
      await abrirFiltros();
      await clicar(botaoDaCategoria("Vestidos"));
      expect(botaoFiltros().textContent).toContain("(1)");

      await digitar("");

      expect(onQueryChange).toHaveBeenLastCalledWith("");
      expect(botaoFiltros().textContent).toContain("(1)");
    });

    it("controle: o topo esvaziar o termo continua zerando os filtros", async () => {
      await abrir("vestido");
      await abrirFiltros();
      await clicar(botaoDaCategoria("Vestidos"));
      expect(botaoFiltros().textContent).toContain("(1)");

      await act(async () => {
        mudarTermoDeFora("");
      });

      expect(caixa().value).toBe("");
      expect(botaoFiltros().textContent).not.toContain("(1)");
    });
  });

  describe("filtros de categoria", () => {
    it("categoria que a lojista escondeu não aparece nos filtros", async () => {
      mockedCategories = [
        categoria("Vestidos", true),
        categoria("Sandálias", false),
      ];
      await abrir();
      await abrirFiltros();
      expect(categoriasNoPainel()).toEqual(["Todas", "Vestidos"]);
    });

    it("compara sem ligar para maiúscula e espaço no nome", async () => {
      mockedCategories = [categoria(" sandálias ", false)];
      await abrir();
      await abrirFiltros();
      expect(categoriasNoPainel()).toEqual(["Todas", "Vestidos"]);
    });

    it("controle: sem a lista de categorias, os filtros seguem como eram", async () => {
      mockedCategories = [];
      await abrir();
      await abrirFiltros();
      expect(categoriasNoPainel()).toEqual(["Todas", "Vestidos", "Sandálias"]);
    });
  });
});
