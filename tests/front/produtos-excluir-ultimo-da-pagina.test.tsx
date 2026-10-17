// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteProduct = vi.fn();
const loadProducts = vi.fn();
const onNavigate = vi.fn();

const produtoTeste = {
  id: "prod-1",
  name: "Produto Teste",
  category: "Geral",
  images: [
    "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
  ],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
};

let catalogo: Array<typeof produtoTeste> = [];
let exclusaoPermitida = true;
let exclusaoLenta = false;
let concluirExclusao: (() => void) | null = null;

vi.mock("@/hooks/useProducts", async () => {
  const { useState } = await import("react");
  return {
    useProducts: () => {
      const [products, setProducts] = useState<Array<typeof produtoTeste>>([]);
      loadProducts.mockImplementation(
        async (pagina: number, tamanho: number) => {
          const products = catalogo.slice(
            pagina * tamanho,
            (pagina + 1) * tamanho,
          );
          setProducts(products);
          return { products, total: catalogo.length };
        },
      );
      deleteProduct.mockImplementation(async (id: string) => {
        if (!exclusaoPermitida) return false;
        if (exclusaoLenta) {
          return new Promise<boolean>((resolve) => {
            concluirExclusao = () => {
              catalogo = catalogo.filter((p) => p.id !== id);
              setProducts((anteriores) =>
                anteriores.filter((p) => p.id !== id),
              );
              resolve(true);
            };
          });
        }
        catalogo = catalogo.filter((p) => p.id !== id);
        setProducts((anteriores) => anteriores.filter((p) => p.id !== id));
        return true;
      });
      return {
        products,
        loading: false,
        deleteProduct,
        loadProducts,
        toggleProductStatus: vi.fn(),
        addProduct: vi.fn(),
      };
    },
  };
});

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
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
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
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
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    onClick?: () => void;
    "aria-label"?: string;
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
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

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    loading: vi.fn(),
  },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === texto || b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("Produtos — exclusão e paginação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    exclusaoPermitida = true;
    exclusaoLenta = false;
    concluirExclusao = null;
    catalogo = Array.from({ length: 13 }, (_, indice) => ({
      ...produtoTeste,
      id: `prod-${indice + 1}`,
      name: `Produto ${indice + 1}`,
    }));
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    armazem = new Map([["admin_products_current_page", "1"]]);
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function aguardarBusca() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
  }

  async function montar() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await aguardarBusca();
  }

  async function excluir() {
    const botao = localizarBotaoPorTexto(hospedeiro, "Excluir Produto");
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
    });
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Confirmar Exclusão")!.click();
    });
    await aguardarBusca();
  }

  function contador() {
    return hospedeiro.querySelector('[data-testid="paginacao-admin"]')
      ?.textContent;
  }

  it("com 13 produtos, excluir o único da página 2 volta à página 1 com total 12", async () => {
    await montar();
    expect(contador()).toContain("Exibindo 13 - 13 de 13");
    loadProducts.mockClear();
    await excluir();

    expect(deleteProduct).toHaveBeenCalledWith("prod-13");
    expect(loadProducts).toHaveBeenLastCalledWith(0, 12, expect.anything());
    expect(armazem.get("admin_products_current_page")).toBe("0");
    expect(contador()).toContain("Exibindo 1 - 12 de 12");
    expect(hospedeiro.textContent).toContain("Produto 1");
    expect(hospedeiro.textContent).not.toContain("Produto 13");
  });

  it("com produtos restantes na página, recarrega a mesma e atualiza o total", async () => {
    catalogo.push({ ...produtoTeste, id: "prod-14", name: "Produto 14" });
    await montar();
    loadProducts.mockClear();
    await excluir();

    expect(loadProducts).toHaveBeenLastCalledWith(1, 12, expect.anything());
    expect(armazem.get("admin_products_current_page")).toBe("1");
    expect(contador()).toContain("Exibindo 13 - 13 de 13");
    expect(hospedeiro.textContent).toContain("Produto 14");
  });

  it("na primeira página, recarrega sem voltar para página negativa", async () => {
    armazem.set("admin_products_current_page", "0");
    await montar();
    loadProducts.mockClear();
    await excluir();

    expect(loadProducts).toHaveBeenLastCalledWith(0, 12, expect.anything());
    expect(armazem.get("admin_products_current_page")).toBe("0");
    expect(contador()).toContain("Exibindo 1 - 12 de 12");
  });

  it("exclusão recusada mantém página, total e produto", async () => {
    exclusaoPermitida = false;
    await montar();
    loadProducts.mockClear();
    await excluir();

    expect(loadProducts).not.toHaveBeenCalled();
    expect(armazem.get("admin_products_current_page")).toBe("1");
    expect(contador()).toContain("Exibindo 13 - 13 de 13");
    expect(hospedeiro.textContent).toContain("Produto 13");
  });

  it("exclusão lenta recarrega a página ATUAL, não a do clique de confirmar", async () => {
    catalogo.push({ ...produtoTeste, id: "prod-14", name: "Produto 14" });
    await montar();
    exclusaoLenta = true;
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Excluir Produto")!.click();
    });
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Confirmar Exclusão")!.click();
    });
    // Enquanto a exclusão não volta, a lojista vai para a página anterior.
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Anterior")!.click();
    });
    await aguardarBusca();
    expect(armazem.get("admin_products_current_page")).toBe("0");
    loadProducts.mockClear();
    await act(async () => {
      concluirExclusao!();
    });
    await aguardarBusca();
    expect(loadProducts).toHaveBeenCalled();
    for (const [pagina] of loadProducts.mock.calls) expect(pagina).toBe(0);
  });
});
