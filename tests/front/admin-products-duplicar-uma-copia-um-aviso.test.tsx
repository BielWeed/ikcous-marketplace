// @vitest-environment jsdom
//
// Caça 9, item 15 — Duplicar produto: sem "Duplicando…" a lojista não sabia se
// o toque valeu e tocava de novo (duas cópias); e o sucesso saía em dois
// avisos (o do hook e o da tela). Agora o botão vira "Duplicando…" (desligado)
// até a cópia terminar, um segundo toque no meio não cria outra cópia, e quem
// avisa o sucesso é só a tela.
//
// Monta `AdminProductsView` de verdade; só os hooks de dados são dublados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const loadProducts = vi.fn();
const copiarImagemParaDuplicacao = vi.fn(async (url: string) => url);
const fetchExecutiveSummary = vi.fn();
const onNavigate = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

const produtoTeste = {
  id: "prod-1",
  name: "Camiseta Base",
  category: "Geral",
  images: [],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
  variants: [],
};

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [produtoTeste],
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct,
    loadProducts,
    copiarImagemParaDuplicacao,
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
    disabled,
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    onClick?: (event: unknown) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  ),
  AlertDialogCancel: ({
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
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, loading: vi.fn() },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botao(raizDom: ParentNode, texto: string) {
  return [...raizDom.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === texto || b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AdminProductsView — duplicar: uma cópia, um aviso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let concluirCopia: ((copia: unknown) => void) | null = null;
  let falharCopia: ((erro: Error) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    concluirCopia = null;
    falharCopia = null;
    loadProducts.mockResolvedValue({ products: [produtoTeste], total: 1 });
    fetchExecutiveSummary.mockResolvedValue(null);
    copiarImagemParaDuplicacao.mockImplementation(async (url: string) => url);
    // A cópia demora até a tela decidir: o teste a conclui ou a faz falhar.
    addProduct.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          concluirCopia = resolve;
          falharCopia = reject;
        }),
    );
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montarEAbrirConfirmacao() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      botao(hospedeiro, "Duplicar Produto")!.click();
    });
    expect(
      botao(hospedeiro, "Duplicar Produto: confirmar duplicação"),
    ).toBeDefined();
  }

  async function confirmar() {
    await act(async () => {
      botao(hospedeiro, "Duplicar Produto: confirmar duplicação")!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("enquanto copia, o botão diz 'Duplicando…', fica desligado e o 'Cancelar' também", async () => {
    await montarEAbrirConfirmacao();
    await confirmar();

    const duplicando = botao(hospedeiro, "Duplicando…");
    expect(duplicando).toBeDefined();
    expect(duplicando!.disabled).toBe(true);
    expect(botao(hospedeiro, "Cancelar")!.disabled).toBe(true);
    // O diálogo segue aberto (é nele que a lojista vê o andamento).
    expect(hospedeiro.textContent).toContain("Confirmar Duplicação");
    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();

    await act(async () => {
      concluirCopia!({ ...produtoTeste, id: "prod-copia" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hospedeiro.textContent).not.toContain("Confirmar Duplicação");
  });

  it("dois toques seguidos (mesmo antes de a tela redesenhar) criam UMA cópia só", async () => {
    await montarEAbrirConfirmacao();
    const confirmarBtn = botao(
      hospedeiro,
      "Duplicar Produto: confirmar duplicação",
    )!;
    await act(async () => {
      confirmarBtn.click();
      confirmarBtn.click();
      confirmarBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(addProduct).toHaveBeenCalledTimes(1);

    await act(async () => {
      concluirCopia!({ ...produtoTeste, id: "prod-copia" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(addProduct).toHaveBeenCalledTimes(1);
  });

  it("sucesso: pede ao hook para calar o aviso dele e a tela avisa UMA vez", async () => {
    await montarEAbrirConfirmacao();
    await confirmar();
    await act(async () => {
      concluirCopia!({ ...produtoTeste, id: "prod-copia" });
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(addProduct).toHaveBeenCalledWith(expect.anything(), {
      avisarSucesso: false,
    });
    expect(toastSuccess).toHaveBeenCalledExactlyOnceWith("Produto Duplicado", {
      description: "O produto foi duplicado com sucesso.",
    });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("falha: o botão volta ao normal, o diálogo fecha e dá para duplicar de novo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await montarEAbrirConfirmacao();
    await confirmar();
    await act(async () => {
      falharCopia!(new Error("falhou"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).not.toContain("Duplicando…");
    expect(hospedeiro.textContent).not.toContain("Confirmar Duplicação");

    // A trava não ficou presa: uma nova tentativa chega ao hook.
    await act(async () => {
      botao(hospedeiro, "Duplicar Produto")!.click();
    });
    await confirmar();
    expect(addProduct).toHaveBeenCalledTimes(2);
    await act(async () => {
      concluirCopia!({ ...produtoTeste, id: "prod-copia-2" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });
});
