// @vitest-environment jsdom
//
// Defeito medido: a lista de produtos lembra, no aparelho, busca, categoria e
// página. O produto recém-cadastrado é o mais recente e cai na página 1; se a
// lojista tinha deixado a lista na página 3, ou filtrada por outra categoria,
// ela voltava do cadastro e não via o produto — parecia que não tinha salvo.
//
// Contrato provado aqui (lado da LISTA; o do formulário está em
// produto-novo-cadastrado-avisa-a-lista.test.tsx):
//   1. Aberta logo depois de CADASTRAR um produto novo: busca e categoria
//      limpas e página 1 — a busca da lista já sai assim.
//   2. Aberta de qualquer outro jeito: continua lembrando busca, categoria e
//      página (não se perde o lugar da lojista à toa).
//   3. O aviso vale uma vez só: a abertura seguinte lembra de novo.
//
// Mesmo padrão de admin-products-lista-honesta-com-busca-e-filtro.test.tsx:
// o estado lembrado entra pelo armazenamento do aparelho, como no app real.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadProducts = vi.fn();
const onNavigate = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
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

describe("AdminProductsView — depois de cadastrar, abre na página 1 sem filtro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(async () => {
    vi.clearAllMocks();
    loadProducts.mockResolvedValue({ products: [], total: 40 });
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
    // A lojista tinha deixado a lista na página 3, buscando "camisa", em Roupas.
    armazem = new Map<string, string>([
      ["admin_products_search_term", JSON.stringify("camisa")],
      ["admin_products_filter_category", JSON.stringify("Roupas")],
      ["admin_products_current_page", JSON.stringify(2)],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    // O aviso é de módulo: começa cada teste zerado.
    const { consumirProdutoNovoCadastrado } = await import(
      "@/utils/produto-recem-cadastrado"
    );
    consumirProdutoNovoCadastrado();
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

  /** Monta a lista escondida (como o painel faz) e a abre, esperando a busca. */
  async function abrirALista() {
    vi.useFakeTimers();
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={false} />);
    });
    return async () => {
      await act(async () => {
        raiz.render(
          <AdminProductsView onNavigate={onNavigate} active={true} />,
        );
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(320);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    };
  }

  it("aberta logo depois de cadastrar: página 1, sem busca e sem categoria", async () => {
    const { avisarProdutoNovoCadastrado } = await import(
      "@/utils/produto-recem-cadastrado"
    );
    const abrir = await abrirALista();

    avisarProdutoNovoCadastrado();
    await abrir();

    // Nenhuma busca saiu com o filtro velho ou com a página 3.
    expect(loadProducts).not.toHaveBeenCalledWith(2, 12, expect.anything());
    expect(loadProducts).toHaveBeenLastCalledWith(0, 12, {
      search: undefined,
      category: undefined,
    });
    // E o aparelho esquece o lugar antigo.
    expect(armazem.get("admin_products_search_term")).toBe('""');
    expect(armazem.get("admin_products_filter_category")).toBe('"all"');
    expect(armazem.get("admin_products_current_page")).toBe("0");
  });

  it("aberta de outro jeito: segue lembrando busca, categoria e página", async () => {
    const abrir = await abrirALista();

    await abrir();

    expect(loadProducts).toHaveBeenLastCalledWith(2, 12, {
      search: "camisa",
      category: "Roupas",
    });
    expect(armazem.get("admin_products_current_page")).toBe("2");
  });

  it("o aviso vale uma abertura só: na seguinte a lista lembra de novo", async () => {
    const { avisarProdutoNovoCadastrado } = await import(
      "@/utils/produto-recem-cadastrado"
    );
    const abrir = await abrirALista();
    avisarProdutoNovoCadastrado();
    await abrir();

    // A lojista volta a navegar: página 2 e uma nova busca, e sai da lista.
    armazem.set("admin_products_current_page", JSON.stringify(1));
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    loadProducts.mockClear();
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });

    expect(loadProducts).toHaveBeenLastCalledWith(1, 12, {
      search: undefined,
      category: undefined,
    });
    expect(armazem.get("admin_products_current_page")).toBe("1");
  });
});
