// @vitest-environment jsdom
//
// Produto PAUSADO nao e' estoque baixo: o Inicio e os Avisos nao o contam
// (alarme falso sobre uma decisao que o lojista ja tomou), entao a lista de
// Produtos tambem nao pode marcar "Critico" nele. Cor e etiqueta ficam neutras
// ("Offline"), nos dois modos de cartao. Produto ATIVO segue igual.
//
// Mesmo padrao de estoque-baixo-um-limiar.test.ts: monta AdminProductsView de
// verdade, sem @testing-library; `.ts` de proposito, os mocks usam createElement.
import { act, createElement } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classeDoTexto } from "@/lib/tons-de-estado";

const deleteProduct = vi.fn();
const addProduct = vi.fn();
const loadProducts = vi.fn();
const toggleProductStatus = vi.fn();
const onNavigate = vi.fn();
const fetchExecutiveSummary = vi.fn();

let produtosMock: any[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: produtosMock,
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

vi.mock("@/components/ui/dropdown-menu", () => {
  const passa = ({ children }: { children: ReactNode }) =>
    createElement("div", null, children);
  return {
    DropdownMenu: passa,
    DropdownMenuTrigger: passa,
    DropdownMenuContent: passa,
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children: ReactNode;
      onClick?: () => void;
    }) => createElement("button", { type: "button", onClick }, children),
  };
});

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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function montarProduto(overrides: Record<string, unknown>) {
  produtosMock = [
    {
      id: "prod-1",
      name: "Produto de Teste",
      category: "Geral",
      images: [
        "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
      ],
      isActive: true,
      stock: 20,
      price: 100,
      costPrice: 40,
      ...overrides,
    },
  ];
}

describe.each(["compact", "detailed"] as const)(
  "AdminProductsView (%s): produto pausado nao e' critico",
  (viewMode) => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;

    beforeEach(() => {
      vi.clearAllMocks();
      loadProducts.mockResolvedValue({ products: produtosMock, total: 1 });
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
      const armazem = new Map<string, string>(
        viewMode === "detailed"
          ? [["admin_products_view_mode", "detailed"]]
          : [],
      );
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
        raiz.render(
          createElement(AdminProductsView, { onNavigate, active: true }),
        );
      });
      await act(async () => {
        await esperarMicrotarefas();
      });
    }

    function cartao(): HTMLElement {
      const classe =
        viewMode === "detailed"
          ? ".content-visibility-detailed-card"
          : ".content-visibility-compact-card";
      const el = hospedeiro.querySelector(classe);
      if (!el) throw new Error("Cartão do produto não está na tela.");
      return el as HTMLElement;
    }

    function numeroDoEstoque(): HTMLElement {
      const alvo = [...cartao().querySelectorAll("span")].find((el) =>
        /^\d+$/.test(el.textContent ?? ""),
      );
      if (!alvo) throw new Error("Número do estoque não está no cartão.");
      return alvo as HTMLElement;
    }

    function rotulos(): (string | null)[] {
      return [...cartao().querySelectorAll('[data-slot="badge"]')].map(
        (el) => el.textContent,
      );
    }

    it("pausado com estoque baixo: fica 'Offline', sem selo 'Crítico', sem cor de alerta e sem 'mín.'", async () => {
      montarProduto({ isActive: false, stock: 2, estoqueMinimo: null });
      await montar();

      expect(rotulos()).toContain("Offline");
      expect(rotulos()).not.toContain("Crítico");
      expect(numeroDoEstoque().className).not.toContain(
        classeDoTexto("atencao"),
      );
      expect(cartao().textContent).not.toMatch(/mín\./);
    });

    it("pausado com estoque zero: tambem sem cor de alerta nem selo", async () => {
      montarProduto({ isActive: false, stock: 0, estoqueMinimo: null });
      await montar();

      expect(rotulos()).toContain("Offline");
      expect(rotulos()).not.toContain("Crítico");
      expect(numeroDoEstoque().className).not.toContain(
        classeDoTexto("negativo"),
      );
      expect(numeroDoEstoque().className).not.toContain(
        classeDoTexto("atencao"),
      );
    });

    it("ativo com estoque baixo segue com o selo 'Crítico' e a cor de atenção", async () => {
      montarProduto({ isActive: true, stock: 2, estoqueMinimo: null });
      await montar();

      expect(rotulos()).toContain("Crítico");
      expect(numeroDoEstoque().className).toContain(classeDoTexto("atencao"));
    });
  },
);
