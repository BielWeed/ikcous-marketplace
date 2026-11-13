// @vitest-environment jsdom
//
// "Ver todos os resultados" da barra do topo abre /search com o termo que a
// caixinha de sugestoes acabou de anunciar, e a caixinha olha a loja INTEIRA.
// Mas a tela /search guardava a categoria escolhida antes: com "Vestidos"
// marcada, buscar "sandalia" no topo mostrava "nenhum resultado" mesmo com a
// sandalia anunciada na caixinha. Agora um termo NOVO vindo de fora devolve a
// categoria a "Todas" (como a Home ja faz); o MESMO termo e a digitacao na
// propria caixa da tela continuam respeitando o que a cliente escolheu.
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

let mockedProducts: Product[] = [];

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

// Mesmo duble de Sheet de search-view-caixa-e-categorias.test.tsx (o Radix real
// precisa de PointerEvent/ResizeObserver que o jsdom daqui nao tem).
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

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchView — busca nova vinda do topo nao herda a categoria", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let mudarTermoDeFora: (termo: string) => void;

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
        onQueryChange={setTermo}
      />
    );
  }

  beforeEach(() => {
    // O jsdom nao tem IntersectionObserver e o card do resultado (LazyImage) o usa.
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
      produto("p1", "Bolsa Palha", "Bolsas"),
      produto("p2", "Sandália Rasa", "Calçados"),
    ];
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

  const esperar = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  async function abrir(inicial = "") {
    await act(async () => {
      raiz.render(<Pai inicial={inicial} />);
    });
    await esperar(20);
  }

  const caixa = () =>
    hospedeiro.querySelector("#search-input") as HTMLInputElement;
  const botoes = () => Array.from(hospedeiro.querySelectorAll("button"));
  const botaoFiltros = () =>
    botoes().find((b) => b.textContent?.startsWith("Filtros")) as HTMLElement;
  const botaoDaCategoria = (nome: string) =>
    botoes().find((b) => b.textContent === nome) as HTMLElement;
  const mostraProduto = (nome: string) =>
    (hospedeiro.textContent ?? "").includes(nome);

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  async function escolherCategoria(nome: string) {
    await clicar(botaoFiltros());
    await clicar(botaoDaCategoria(nome));
  }
  async function digitarNaCaixa(texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(caixa(), texto);
      caixa().dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Passa a espera da caixa (300 ms) e a da lista.
    await esperar(450);
  }

  it("termo novo do topo devolve a categoria a Todas e mostra o que a caixinha achou", async () => {
    await abrir("bolsa");
    await escolherCategoria("Bolsas");
    expect(botaoFiltros().textContent).toContain("(1)");

    await act(async () => {
      mudarTermoDeFora("sandalia");
    });
    await esperar(450);

    expect(caixa().value).toBe("sandalia");
    expect(botaoFiltros().textContent).not.toContain("(1)");
    expect(mostraProduto("Sandália Rasa")).toBe(true);
  });

  it("controle: o MESMO termo de novo nao mexe na categoria da cliente", async () => {
    await abrir("bolsa");
    await escolherCategoria("Bolsas");

    await act(async () => {
      mudarTermoDeFora("bolsa");
    });
    await esperar(450);

    expect(botaoFiltros().textContent).toContain("(1)");
  });

  it("controle: digitar na propria caixa da tela mantem a categoria escolhida", async () => {
    await abrir("bolsa");
    await escolherCategoria("Bolsas");

    await digitarNaCaixa("palha");

    expect(caixa().value).toBe("palha");
    expect(botaoFiltros().textContent).toContain("(1)");
    expect(mostraProduto("Bolsa Palha")).toBe(true);
  });
});
