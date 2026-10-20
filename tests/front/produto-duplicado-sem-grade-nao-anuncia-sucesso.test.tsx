// @vitest-environment jsdom
// A view precisa respeitar o resultado parcial do hook: a cópia existe,
// mas a grade falhou. Estes testes exercitam o diálogo e o handler reais.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const loadProducts = vi.fn();
const deleteProduct = vi.fn();
const toggleProductStatus = vi.fn();
// Identidade: o helper de cópia de imagem não é o alvo deste teste (já tem
// suíte própria em duplicar-produto-copia-as-fotos-do-storage.test.ts).
const copiarImagemParaDuplicacao = vi.fn(async (url: string) => url);
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastLoading = vi.fn();

const produtoTeste = {
  id: "prod-1",
  name: "Camiseta Base",
  category: "Geral",
  images: [
    "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
  ],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
  variants: [
    { id: "v-p", name: "Tamanho", value: "P", sku: "CAM-P", active: true },
    { id: "v-m", name: "Tamanho", value: "M", sku: "CAM-M", active: true },
  ],
};

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [produtoTeste],
    loading: false,
    deleteProduct,
    toggleProductStatus,
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
  return [...raizDom.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === texto || b.textContent?.includes(texto),
  );
}

describe("AdminProductsView — duplicação com grade não salva", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    loadProducts.mockResolvedValue({ products: [produtoTeste], total: 1 });
    fetchExecutiveSummary.mockResolvedValue(null);
    addProduct.mockResolvedValue({ ...produtoTeste, id: "prod-copia" });
    copiarImagemParaDuplicacao.mockImplementation(async (url: string) => url);

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

  async function duplicar() {
    const botaoDuplicar = localizarBotaoPorTexto(
      hospedeiro,
      "Duplicar Produto",
    )!;
    expect(botaoDuplicar).toBeDefined();
    await act(async () => {
      botaoDuplicar.click();
    });

    const botaoConfirmar = localizarBotaoPorTexto(
      hospedeiro,
      "Duplicar Produto: confirmar duplicação",
    )!;
    expect(botaoConfirmar).toBeDefined();
    await act(async () => {
      botaoConfirmar.click();
      await esperarMicrotarefas();
    });
  }

  it.each([null, "Este SKU já está em uso."])(
    "avisa que a cópia existe sem tamanhos, sem anunciar sucesso (motivo: %s)",
    async (motivo) => {
      addProduct.mockResolvedValue({
        ...produtoTeste,
        id: "prod-copia",
        variants: [],
        variantesNaoSalvas: { motivo },
      });
      await montar();
      fetchExecutiveSummary.mockClear();
      await duplicar();

      expect(addProduct).toHaveBeenCalledTimes(1);
      expect(toastSuccess).not.toHaveBeenCalled();
      // O aviso com o motivo já saiu de `addProduct` (mockado aqui): a tela
      // não empilha um segundo erro, só deixa de anunciar sucesso.
      expect(toastError).not.toHaveBeenCalled();
      expect(
        localizarBotaoPorTexto(
          hospedeiro,
          "Duplicar Produto: confirmar duplicação",
        ),
      ).toBeUndefined();
      expect(fetchExecutiveSummary).toHaveBeenCalledExactlyOnceWith(true);
    },
  );

  it("mantém o anúncio de Produto Duplicado quando toda a grade é salva", async () => {
    await montar();
    fetchExecutiveSummary.mockClear();
    await duplicar();

    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledExactlyOnceWith("Produto Duplicado", {
      description: "O produto foi duplicado com sucesso.",
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(
      localizarBotaoPorTexto(
        hospedeiro,
        "Duplicar Produto: confirmar duplicação",
      ),
    ).toBeUndefined();
    expect(fetchExecutiveSummary).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("mantém o erro de duplicação e fecha o diálogo quando addProduct rejeita", async () => {
    const erro = new Error("Falha fictícia ao criar a cópia");
    addProduct.mockRejectedValue(erro);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await montar();
    fetchExecutiveSummary.mockClear();
    await duplicar();

    expect(addProduct).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledExactlyOnceWith("Erro na Duplicação", {
      description: "Não foi possível duplicar o produto.",
    });
    expect(
      localizarBotaoPorTexto(
        hospedeiro,
        "Duplicar Produto: confirmar duplicação",
      ),
    ).toBeUndefined();
    expect(fetchExecutiveSummary).not.toHaveBeenCalled();
  });
});
