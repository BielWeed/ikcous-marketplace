// @vitest-environment jsdom
//
// Defeitos medidos na tela Produtos do painel (leitura de código):
//
//   (a) Com BUSCA ou FILTRO de categoria ativo e nenhum resultado, a tela
//       dizia "Nenhum produto cadastrado" — a lojista achava que os produtos
//       tinham sumido. Agora diz "Nenhum produto encontrado", mostra o que
//       está filtrado e oferece "Limpar busca e filtros". Sem filtro, o texto
//       continua o de sempre.
//   (b) O cartão "Produtos no Catálogo" mostra o total FILTRADO, mas só a
//       busca trocava a legenda ("Resultados da busca"); com filtro de
//       categoria ela seguia "Catálogo Geral".
//
// Mesmo padrão de admin-products-nao-afirma-vazio-antes-de-perguntar.test.tsx:
// monta `AdminProductsView` de verdade, relógio falso ligado ANTES do render.
// O filtro entra pelo mesmo lugar de onde a tela o lê no mundo real: o
// armazenamento do aparelho (`admin_products_*`).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadProducts = vi.fn();
const onNavigate = vi.fn();

let produtosMock: any[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 500, totalValue: 900 } },
    fetchExecutiveSummary: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function tresProdutos() {
  return Array.from({ length: 3 }).map((_, i) => ({
    id: `prod-${i}`,
    name: `Produto ${i}`,
    category: "Roupas",
    images: [],
    isActive: true,
    stock: 10,
    price: 100,
  }));
}

describe("AdminProductsView — a lista não mente quando há busca ou filtro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    produtosMock = [];
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
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
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Filtro guardado no aparelho, como a tela o guarda de verdade. */
  function guardarFiltro(filtros: { busca?: string; categoria?: string }) {
    if (filtros.busca !== undefined)
      armazem.set("admin_products_search_term", JSON.stringify(filtros.busca));
    if (filtros.categoria !== undefined)
      armazem.set(
        "admin_products_filter_category",
        JSON.stringify(filtros.categoria),
      );
  }

  async function montarEEsperarPrimeiraBusca() {
    vi.useFakeTimers();
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  describe("(a) estado vazio", () => {
    it("sem busca nem filtro e nenhum produto: segue 'Nenhum produto cadastrado', sem botão de limpar", async () => {
      loadProducts.mockResolvedValue({ products: [], total: 0 });

      await montarEEsperarPrimeiraBusca();

      expect(hospedeiro.textContent).toContain("Nenhum produto cadastrado");
      expect(hospedeiro.textContent).not.toContain("Nenhum produto encontrado");
      expect(botao("Limpar busca e filtros")).toBeUndefined();
    });

    it("com BUSCA que não achou nada: diz 'encontrado', mostra o termo e oferece limpar", async () => {
      guardarFiltro({ busca: "camisa azul" });
      loadProducts.mockResolvedValue({ products: [], total: 0 });

      await montarEEsperarPrimeiraBusca();

      expect(hospedeiro.textContent).toContain("Nenhum produto encontrado");
      expect(hospedeiro.textContent).not.toContain("Nenhum produto cadastrado");
      expect(hospedeiro.textContent).toContain("camisa azul");
      expect(botao("Limpar busca e filtros")).toBeDefined();
    });

    it("com FILTRO de categoria que não achou nada: diz 'encontrado', mostra a categoria e oferece limpar", async () => {
      guardarFiltro({ categoria: "Calçados" });
      loadProducts.mockResolvedValue({ products: [], total: 0 });

      await montarEEsperarPrimeiraBusca();

      expect(hospedeiro.textContent).toContain("Nenhum produto encontrado");
      expect(hospedeiro.textContent).not.toContain("Nenhum produto cadastrado");
      expect(hospedeiro.textContent).toContain("Calçados");
      expect(botao("Limpar busca e filtros")).toBeDefined();
    });

    it("tocar em 'Limpar busca e filtros' volta para todas as categorias, sem busca, na página 1", async () => {
      guardarFiltro({ busca: "camisa", categoria: "Calçados" });
      loadProducts.mockResolvedValue({ products: [], total: 0 });
      await montarEEsperarPrimeiraBusca();
      loadProducts.mockClear();

      await act(async () => {
        botao("Limpar busca e filtros")?.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(320);
      });

      expect(loadProducts).toHaveBeenLastCalledWith(0, 12, {
        search: undefined,
        category: undefined,
      });
      // Sem filtro e sem produto: volta o texto de catálogo realmente vazio.
      expect(hospedeiro.textContent).toContain("Nenhum produto cadastrado");
      expect(botao("Limpar busca e filtros")).toBeUndefined();
      // E o aparelho esquece o filtro (não volta na próxima abertura).
      expect(armazem.get("admin_products_search_term")).toBe('""');
      expect(armazem.get("admin_products_filter_category")).toBe('"all"');
    });
  });

  describe("(b) legenda do cartão 'Produtos no Catálogo'", () => {
    async function montarComProdutos() {
      loadProducts.mockImplementation(async () => {
        produtosMock = tresProdutos();
        return { products: produtosMock, total: 3 };
      });
      await montarEEsperarPrimeiraBusca();
      await act(async () =>
        hospedeiro
          .querySelector<HTMLButtonElement>("button[aria-expanded]")!
          .click(),
      );
    }

    it("sem busca nem filtro: 'Catálogo Geral'", async () => {
      await montarComProdutos();

      expect(hospedeiro.textContent).toContain("Catálogo Geral");
    });

    it("só com busca: 'Resultados da busca' (como antes)", async () => {
      guardarFiltro({ busca: "camisa" });
      await montarComProdutos();

      expect(hospedeiro.textContent).toContain("Resultados da busca");
      expect(hospedeiro.textContent).not.toContain("Catálogo Geral");
    });

    it("só com filtro de categoria: a legenda deixa de dizer 'Catálogo Geral'", async () => {
      guardarFiltro({ categoria: "Roupas" });
      await montarComProdutos();

      expect(hospedeiro.textContent).not.toContain("Catálogo Geral");
      expect(hospedeiro.textContent).toContain("Só desta categoria");
    });
  });
});
