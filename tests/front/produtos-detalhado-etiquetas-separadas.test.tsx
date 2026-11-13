// @vitest-environment jsdom
//
// Produtos, modo detalhado: produto crítico mostrava as etiquetas coladas,
// "Em OperaçãoCrítico". As duas são `<span>` em linha (o CSS do catálogo tira
// a caixa do `Badge`) e não havia espaço entre elas no JSX; o espaço também é
// o que o leitor de tela precisa para ler duas palavras e não uma.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: { inventory: { totalCost: 300, totalValue: 690.5 } },
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
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  produtosMock = [
    {
      id: "prod-1",
      name: "Vestido de linho",
      category: "Vestidos",
      images: [],
      isActive: true,
      stock: 1,
      price: 15,
      costPrice: 10,
      estoqueMinimo: null,
    },
  ];
  loadProducts.mockImplementation(async () => ({
    products: produtosMock,
    total: 1,
  }));
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
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

it("o produto crítico no cartão detalhado separa 'Em Operação' de 'Crítico'", async () => {
  const { AdminProductsView } = await import("@/views/admin/AdminProductsView");
  await act(async () => {
    raiz.render(<AdminProductsView onNavigate={onNavigate} active={true} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const cartao = hospedeiro.querySelector(".content-visibility-detailed-card");
  expect(cartao).not.toBeNull();
  const texto = (cartao?.textContent ?? "").replace(/\s/g, " ");
  expect(texto).toContain("Em Operação Crítico");
  expect(texto).not.toContain("OperaçãoCrítico");
});
