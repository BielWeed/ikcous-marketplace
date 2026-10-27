// @vitest-environment jsdom
//
// Caça 9, item 11 — "Nenhum produto cadastrado" piscava ao excluir o último
// produto da última página: o hook tira o produto da lista na hora (antes de o
// servidor responder), a lista fica vazia e a tela, que não sabia que a
// atualização estava em andamento, afirmava que não havia produto nenhum. Depois
// a recarga voltava com a página que já não existe (vazia) e o vazio piscava
// de novo até a busca da página certa, 320 ms depois.
//
// O dublê de `useProducts` aqui imita o hook REAL nos dois pontos que importam:
// `deleteProduct` remove da lista antes de terminar, e `loadProducts` liga
// `loading` enquanto busca. Cada etapa é travada, para olhar a tela ENTRE elas.
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
let travarExclusao = false;
let travarRecargas = false;
let concluirExclusao: (() => void) | null = null;
const recargasPendentes: Array<() => void> = [];

vi.mock("@/hooks/useProducts", async () => {
  const { useState } = await import("react");
  return {
    useProducts: () => {
      const [products, setProducts] = useState<Array<typeof produtoTeste>>([]);
      const [loading, setLoading] = useState(false);
      loadProducts.mockImplementation(
        async (pagina: number, tamanho: number) => {
          setLoading(true);
          if (travarRecargas) {
            await new Promise<void>((liberar) => {
              recargasPendentes.push(liberar);
            });
          }
          const pagina_ = catalogo.slice(
            pagina * tamanho,
            (pagina + 1) * tamanho,
          );
          setProducts(pagina_);
          setLoading(false);
          return { products: pagina_, total: catalogo.length };
        },
      );
      deleteProduct.mockImplementation(async (id: string) => {
        if (!exclusaoPermitida) return false;
        // Como o hook real: a lista perde o produto ANTES do servidor responder.
        setProducts((anteriores) => anteriores.filter((p) => p.id !== id));
        if (travarExclusao) {
          await new Promise<void>((liberar) => {
            concluirExclusao = liberar;
          });
        }
        catalogo = catalogo.filter((p) => p.id !== id);
        return true;
      });
      return {
        products,
        loading,
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
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VAZIO = "Nenhum produto cadastrado";

function botao(raizDom: ParentNode, texto: string) {
  return [...raizDom.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === texto || b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("Produtos — excluir o último da página não pisca 'Nenhum produto cadastrado'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    exclusaoPermitida = true;
    travarExclusao = false;
    travarRecargas = false;
    concluirExclusao = null;
    recargasPendentes.length = 0;
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

  async function passarTempo(ms = 320) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await passarTempo();
  }

  async function pedirExclusao() {
    await act(async () => {
      botao(hospedeiro, "Excluir Produto")!.click();
    });
    await act(async () => {
      botao(hospedeiro, "Excluir Produto: confirmar exclusão")!.click();
    });
  }

  async function liberarRecarga() {
    await act(async () => {
      recargasPendentes.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("último da última página: o vazio nunca aparece, nem entre as etapas, e termina na última página que existe", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain("Produto 13");
    travarExclusao = true;
    travarRecargas = true;

    await pedirExclusao();
    // 1) O servidor ainda não respondeu e o hook já tirou o produto da lista.
    expect(hospedeiro.textContent).not.toContain(VAZIO);
    expect(hospedeiro.textContent).not.toContain("Produto 13");

    // 2) O servidor confirmou: a recarga começa (travada).
    await act(async () => {
      concluirExclusao!();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(recargasPendentes.length).toBeGreaterThan(0);
    expect(hospedeiro.textContent).not.toContain(VAZIO);

    // 3) A recarga volta com a página 2, que já não existe (vazia, total 12):
    //    a tela vai direto buscar a última página válida, sem mostrar vazio.
    await liberarRecarga();
    expect(hospedeiro.textContent).not.toContain(VAZIO);
    expect(armazem.get("admin_products_current_page")).toBe("0");
    expect(loadProducts).toHaveBeenLastCalledWith(0, 12, expect.anything());

    // 4) A busca da página certa chega.
    await liberarRecarga();
    expect(hospedeiro.textContent).not.toContain(VAZIO);
    expect(hospedeiro.textContent).toContain("Produto 1");
    expect(
      hospedeiro.querySelector('[data-testid="paginacao-admin"]')?.textContent,
    ).toContain("Exibindo 1 - 12 de 12");

    // 5) A busca automática da página nova (320 ms) não traz o vazio de volta.
    travarRecargas = false;
    await passarTempo();
    expect(hospedeiro.textContent).not.toContain(VAZIO);
    expect(hospedeiro.textContent).toContain("Produto 1");
    expect(hospedeiro.textContent).not.toContain("Recarregando");
  });

  it("o único produto do catálogo: o vazio aparece, mas só quando a recarga confirma que acabou", async () => {
    catalogo = [catalogo[0]];
    armazem.set("admin_products_current_page", "0");
    await montar();
    expect(hospedeiro.textContent).toContain("Produto 1");
    travarExclusao = true;
    travarRecargas = true;

    await pedirExclusao();
    expect(hospedeiro.textContent).not.toContain(VAZIO);

    await act(async () => {
      concluirExclusao!();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hospedeiro.textContent).not.toContain(VAZIO);

    await liberarRecarga();
    // Agora é verdade: o servidor respondeu que o catálogo está vazio.
    expect(hospedeiro.textContent).toContain(VAZIO);
    travarRecargas = false;
    await passarTempo();
    expect(hospedeiro.textContent).toContain(VAZIO);
  });

  it("exclusão recusada: o produto volta, sem vazio nem 'Recarregando' preso", async () => {
    exclusaoPermitida = false;
    await montar();
    await pedirExclusao();
    await passarTempo();
    expect(hospedeiro.textContent).toContain("Produto 13");
    expect(hospedeiro.textContent).not.toContain(VAZIO);
    expect(hospedeiro.textContent).not.toContain("Recarregando");
  });

  it("dois produtos na página: excluir um nunca mostra vazio e a lista segue com o outro", async () => {
    catalogo.push({ ...produtoTeste, id: "prod-14", name: "Produto 14" });
    await montar();
    expect(hospedeiro.textContent).toContain("Produto 14");
    travarExclusao = true;

    await pedirExclusao();
    expect(hospedeiro.textContent).not.toContain(VAZIO);
    expect(hospedeiro.textContent).toContain("Produto 14");
    await act(async () => {
      concluirExclusao!();
      await Promise.resolve();
      await Promise.resolve();
    });
    await passarTempo();
    expect(hospedeiro.textContent).not.toContain(VAZIO);
    expect(hospedeiro.textContent).toContain("Produto 14");
  });
});
