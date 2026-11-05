// @vitest-environment jsdom
//
// Produto LEGADO com DOIS grupos de variacao separados (ex.: Cor e Tamanho como
// grupos independentes): o servidor baixa o estoque so da primeira escolha. O
// painel ja nao deixa CRIAR assim (src/utils/um-grupo-de-variacao.ts), mas:
//  - a lista precisa MARCAR esses produtos, para a lojista saber que existem;
//  - o Duplicar copiava as variacoes sem passar pela regra -- era a unica porta
//    que ainda criava produto novo com os dois grupos. Agora o bloqueia.
//
// Monta `AdminProductsView` de verdade; so os hooks de dados sao dublados.
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

const variante = (id: string, name: string, value: string) => ({
  id,
  productId: "prod-1",
  name,
  value,
  stockIncrement: 3,
  active: true,
});

const produtoBase = {
  id: "prod-1",
  name: "Camiseta Base",
  category: "Geral",
  images: [],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
};
const doisGrupos = {
  ...produtoBase,
  variants: [variante("v1", "Cor", "Azul"), variante("v2", "Tamanho", "P")],
};
const umGrupo = {
  ...produtoBase,
  variants: [variante("v1", "Cor", "Azul"), variante("v2", "Cor", "Rosa")],
};
// `vi.mock` sobe para o topo do arquivo: o objeto mutavel precisa existir antes.
const produtoAtual = vi.hoisted(() => ({
  valor: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [produtoAtual.valor],
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

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botao(raizDom: ParentNode, texto: string) {
  return [...raizDom.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === texto || b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

const ETIQUETA = "Estoque de uma variação não desce";

describe("AdminProductsView — produto com dois grupos de variação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montar(modo: "compact" | "detailed", produto: object) {
    produtoAtual.valor = produto as Record<string, unknown>;
    loadProducts.mockResolvedValue({ products: [produto], total: 1 });
    localStorage.setItem("admin_products_view_mode", modo);
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    fetchExecutiveSummary.mockResolvedValue(null);
    copiarImagemParaDuplicacao.mockImplementation(async (url: string) => url);
    addProduct.mockResolvedValue({ ...produtoBase, id: "prod-copia" });
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

  it.each(["compact", "detailed"] as const)(
    "lista (%s): marca o produto com dois grupos e diz como consertar",
    async (modo) => {
      await montar(modo, doisGrupos);
      expect(hospedeiro.textContent).toContain(ETIQUETA);
      const marca = hospedeiro.querySelector("[data-dois-grupos]");
      expect(marca?.getAttribute("title")).toContain("Cadastre as combinações");
      expect(marca?.getAttribute("title")).toContain("Azul P");
    },
  );

  it.each(["compact", "detailed"] as const)(
    "lista (%s): produto com um grupo só não leva etiqueta",
    async (modo) => {
      await montar(modo, umGrupo);
      expect(hospedeiro.textContent).not.toContain(ETIQUETA);
      expect(hospedeiro.querySelector("[data-dois-grupos]")).toBeNull();
    },
  );

  it("Duplicar com dois grupos: avisa, não abre a confirmação e não cria nada", async () => {
    await montar("compact", doisGrupos);
    await act(async () => {
      botao(hospedeiro, "Duplicar Produto")!.click();
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[1]).toMatchObject({
      description:
        "Este produto tem dois grupos de variação separados. Cadastre as combinações no produto original antes de duplicar.",
    });
    expect(hospedeiro.textContent).not.toContain("Confirmar Duplicação");
    expect(addProduct).not.toHaveBeenCalled();
  });

  it("Duplicar com um grupo só segue como sempre: abre a confirmação", async () => {
    await montar("compact", umGrupo);
    await act(async () => {
      botao(hospedeiro, "Duplicar Produto")!.click();
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Confirmar Duplicação");
  });
});
