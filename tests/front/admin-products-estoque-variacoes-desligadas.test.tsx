// @vitest-environment jsdom
//
// Cartão detalhado do produto, "Mais métricas": o "Estoque total das
// variações" é a soma só das variações LIGADAS, mas a lista logo abaixo trazia
// também as desligadas, sem marca ("total 5" ao lado de "P: 5 · M: 3 · G: 2").
// Agora cada variação desligada vem marcada "(desligada)" e uma linha diz que
// elas não entram no total. Sem variação desligada, nada muda.
//
// Monta `AdminProductsView` de verdade; molde de
// admin-products-margem-sem-custo.test.tsx.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadProducts = vi.fn();
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();

let produtosMock: any[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts,
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: {
      inventory: {
        totalCost: 500,
        totalValue: 900,
        totalRevenue: 900,
        revenueWithoutCost: 0,
        productsWithoutCost: 0,
        productsWithCost: 1,
      },
    },
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

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const variacao = (valor: string, estoque: number, ativa: boolean) => ({
  id: `v-${valor}`,
  value: valor,
  name: "Tamanho",
  stockIncrement: estoque,
  active: ativa,
  priceOverride: null,
});

describe("Produtos (cartão detalhado): variações desligadas ficam marcadas e fora do total", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchExecutiveSummary.mockResolvedValue(null);
    loadProducts.mockImplementation(async () => ({
      products: produtosMock,
      total: produtosMock.length,
    }));
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
    const armazem = new Map<string, string>([
      ["admin_products_view_mode", "detailed"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
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

  async function montarComVariacoes(
    variantes: ReturnType<typeof variacao>[],
    stockDoProduto: number,
  ): Promise<string> {
    produtosMock = [
      {
        id: "prod-1",
        name: "Camiseta",
        category: "Geral",
        images: [],
        isActive: true,
        stock: stockDoProduto,
        price: 100,
        costPrice: 40,
        variants: variantes,
      },
    ];
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const abrir = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-controls="metricas-produto-prod-1"]',
    );
    expect(abrir).not.toBeNull();
    await act(async () => abrir?.click());
    const cartao = hospedeiro.querySelector(
      ".content-visibility-detailed-card",
    );
    expect(cartao).not.toBeNull();
    return cartao?.textContent ?? "";
  }

  it("com P ligada (5) e M e G desligadas: total 5, M e G marcadas e o aviso de que não entram", async () => {
    const texto = await montarComVariacoes(
      [
        variacao("P", 5, true),
        variacao("M", 3, false),
        variacao("G", 2, false),
      ],
      5,
    );
    expect(texto).toContain("Estoque total das variações: 5 unidades");
    expect(texto).toContain("P: 5 · M: 3 (desligada) · G: 2 (desligada)");
    expect(texto).not.toContain("P: 5 (desligada)");
    expect(texto).toContain("não entram no total");
  });

  it("controle: todas as variações ligadas, a lista sai como sempre e sem aviso", async () => {
    const texto = await montarComVariacoes(
      [variacao("P", 5, true), variacao("M", 3, true)],
      8,
    );
    expect(texto).toContain("Estoque total das variações: 8 unidades");
    expect(texto).toContain("P: 5 · M: 3");
    expect(texto).not.toContain("(desligada)");
    expect(texto).not.toContain("não entram no total");
  });

  it("borda: todas desligadas, todas marcadas e o aviso aparece (o total é o do produto, não a soma)", async () => {
    const texto = await montarComVariacoes(
      [variacao("P", 5, false), variacao("M", 3, false)],
      4,
    );
    expect(texto).toContain("P: 5 (desligada) · M: 3 (desligada)");
    expect(texto).toContain("não entram no total");
  });
});
