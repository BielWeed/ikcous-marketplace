// @vitest-environment jsdom
//
// Excluir um produto só com o teclado: a lixeira some com o cartão e o foco
// caía no corpo da página. Depois de EXCLUIR o foco vai para o título da tela;
// em "Cancelar" volta para a lixeira de onde saiu. Monta a tela de verdade, com
// a janela de confirmação REAL (o Radix é quem decide para onde o foco vai).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadProducts = vi.fn();

const produto = (id: string, name: string) => ({
  id,
  name,
  category: "Geral",
  images: [
    "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
  ],
  isActive: true,
  stock: 10,
  price: 100,
  costPrice: 50,
});

let mockProdutos = [
  produto("prod-1", "Produto Um"),
  produto("prod-2", "Produto Dois"),
];
const deleteProduct = vi.fn(async (id: string) => {
  mockProdutos = mockProdutos.filter((p) => p.id !== id);
  return true;
});

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: mockProdutos,
    loading: false,
    deleteProduct,
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts,
  }),
}));

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

// O menu do cartão abre por ponteiro, que o jsdom não faz: renderiza os itens direto.
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

const esperar = () => new Promise<void>((r) => setTimeout(r, 30));

describe("AdminProductsView — o foco depois de excluir", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProdutos = [
      produto("prod-1", "Produto Um"),
      produto("prod-2", "Produto Dois"),
    ];
    loadProducts.mockResolvedValue({ products: mockProdutos, total: 2 });
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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

  async function montarEPedirExclusao() {
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
    const lixeira = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Excluir Produto"),
    );
    expect(lixeira).toBeDefined();
    lixeira?.focus();
    await act(async () => {
      lixeira?.click();
      await esperar();
    });
    return lixeira as HTMLButtonElement;
  }

  const botaoDaPergunta = (rotulo: string) =>
    [...document.querySelectorAll("button")].find(
      (b) =>
        b.getAttribute("aria-label") === rotulo ||
        b.textContent?.trim() === rotulo,
    );

  it("excluiu: o foco vai para o título da tela, não para o corpo da página", async () => {
    await montarEPedirExclusao();
    await act(async () => {
      botaoDaPergunta("Excluir Produto: confirmar exclusão")?.click();
      await esperar();
    });
    await act(async () => {
      await esperar();
    });

    expect(deleteProduct).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(hospedeiro.querySelector("h1")),
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("cancelou: o foco volta para a lixeira de onde saiu", async () => {
    const lixeira = await montarEPedirExclusao();
    await act(async () => {
      botaoDaPergunta("Cancelar")?.click();
      await esperar();
    });
    expect(deleteProduct).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(lixeira));
  });
});
