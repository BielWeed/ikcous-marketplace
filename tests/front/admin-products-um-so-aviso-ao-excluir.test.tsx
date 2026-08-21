// @vitest-environment jsdom
//
// Achado 16 da auditoria de 20/08/2026
// (docs/auditoria/2026-08-20-painel-pedidos-produtos.md): ao excluir um
// produto com sucesso, dois avisos apareciam empilhados — "Produto
// removido" (de `useProducts.ts:896`, dentro de `deleteProduct`, que
// executa a exclusão e sabe o resultado no mesmo instante em que ele
// acontece) e "Produto Removido" com descrição (de
// `AdminProductsView.tsx`, incondicional sempre que `sucesso` era `true`).
// Um produto só foi removido.
//
// O caminho de FALHA já seguia a regra certa: só o hook mostra
// `toast.error`, e a view fica calada (`else { haptic.error(); }`, sem
// toast). A correção aplica a MESMA regra ao sucesso — o aviso mora só no
// hook, que é quem sabe o resultado e tem o contexto para descrevê-lo, e é
// o padrão usado por toda outra mutação do hook (criar, atualizar,
// alternar status, variantes: todas avisam de dentro do próprio hook,
// nunca da view). `deleteProduct` só tem UM chamador em todo o `src/`
// (conferido com `find_referencing_symbols` antes de decidir) — não hà
// nenhum outro caminho que dependesse do toast da view.
//
// Este teste mocka `useProducts` inteiro (mesmo padrão de
// admin-products-kpi-apos-mexer-no-catalogo.test.tsx), então o
// `toast.success("Produto removido")` REAL do hook nunca roda aqui — o que
// ele prova é a metade que é desta view: que ela parou de EMITIR o próprio
// aviso de sucesso.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteProduct = vi.fn();
const addProduct = vi.fn();
const loadProducts = vi.fn();
const toggleProductStatus = vi.fn();
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastLoading = vi.fn();

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

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [produtoTeste],
    loading: false,
    deleteProduct,
    toggleProductStatus,
    addProduct,
    loadProducts,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 500, totalValue: 900 } },
    fetchExecutiveSummary,
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
  toast: {
    success: toastSuccess,
    error: toastError,
    loading: toastLoading,
  },
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em address-form-cep-race.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AdminProductsView — achado 16: excluir produto não duplica o aviso de sucesso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockResolvedValue({ products: [produtoTeste], total: 1 });
    fetchExecutiveSummary.mockResolvedValue(null);
    addProduct.mockResolvedValue(undefined);
    toggleProductStatus.mockResolvedValue(true);

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
    const armazem = new Map<string, string>();
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
  });

  async function montar() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );

    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function excluir() {
    const botaoExcluir = localizarBotaoPorTexto(hospedeiro, "Excluir Produto")!;
    expect(botaoExcluir).toBeDefined();
    await act(async () => {
      botaoExcluir.click();
    });

    const botaoConfirmar = localizarBotaoPorTexto(
      hospedeiro,
      "Confirmar Exclusão",
    )!;
    expect(botaoConfirmar).toBeDefined();
    await act(async () => {
      botaoConfirmar.click();
      await esperarMicrotarefas();
    });
  }

  it("exclusão com sucesso: a VIEW não emite o próprio toast.success — quem avisa é só o hook", async () => {
    deleteProduct.mockResolvedValue(true);

    await montar();
    await excluir();

    expect(deleteProduct).toHaveBeenCalledWith("prod-1");
    // Antes da correção, este era o ponto onde a view chamava
    // `toast.success("Produto Removido", {...})` — incondicional sempre
    // que `sucesso` era `true`. `deleteProduct` está mockado aqui (o
    // `toast.success("Produto removido")` REAL do hook nunca roda dentro
    // deste teste), então zero chamadas é exatamente o que a view sozinha
    // deve produzir.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("caso-limite (regressão): exclusão que FALHA continua sem toast da view — só o hook avisaria, e ele está mockado aqui", async () => {
    deleteProduct.mockResolvedValue(false);

    await montar();
    await excluir();

    expect(deleteProduct).toHaveBeenCalledWith("prod-1");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
