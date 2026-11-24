// @vitest-environment jsdom
//
// Lista de Produtos do painel (AdminProductsView), cartão do produto, nos DOIS
// modos: duas bordas do aviso de estoque que os testes irmãos não prendiam
// (achadas por mutação):
//
//  (1) Estoque ZERO de produto ativo é vermelho ("negativo"), nunca o âmbar
//      de "acabando". Zerou é outra coisa que "está baixo": o número tem de
//      sair vermelho, mesmo com o produto também contando como "baixo".
//  (2) Produto PAUSADO (Offline) não alerta: sem selo "Crítico" mesmo com
//      estoque abaixo do mínimo, e o número fica sem cor de alarme — alarme
//      sobre uma decisão que a lojista já tomou.
//  (3) O "mín." mostrado é o do produto; mínimo ZERO aparece como 0, não
//      vira o padrão 5 (a escolha "não me avise" é dela).
//
// Mesmo arranque de estoque-baixo-um-limiar.test.ts (sem @testing-library,
// mocks com createElement).
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

let produtosMock: Record<string, unknown>[] = [];

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

const VERMELHO = classeDoTexto("negativo");
const AMBAR = classeDoTexto("atencao");

describe.each(["compact", "detailed"] as const)(
  "AdminProductsView (%s): estoque zero e produto pausado na lista",
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

    function temSeloCritico(): boolean {
      return [...cartao().querySelectorAll('[data-slot="badge"]')].some(
        (el) => el.textContent === "Crítico",
      );
    }

    function rotulosDeStatus(): (string | null)[] {
      return [...cartao().querySelectorAll('[data-slot="badge"]')].map(
        (el) => el.textContent,
      );
    }

    it("ativo com estoque 0: o número sai VERMELHO, não âmbar", async () => {
      montarProduto({ stock: 0, estoqueMinimo: null });
      await montar();

      expect(rotulosDeStatus()).toContain("Esgotado");
      const classe = numeroDoEstoque().className;
      expect(classe).toContain(VERMELHO);
      expect(classe).not.toContain(AMBAR);
    });

    it("ativo com estoque 1 (baixo, não zerou): o número é âmbar, não vermelho", async () => {
      montarProduto({ stock: 1, estoqueMinimo: null });
      await montar();

      const classe = numeroDoEstoque().className;
      expect(classe).toContain(AMBAR);
      expect(classe).not.toContain(VERMELHO);
    });

    it("ativo com estoque 0 e mínimo 0 ('não me avise'): continua vermelho ao zerar", async () => {
      montarProduto({ stock: 0, estoqueMinimo: 0 });
      await montar();

      expect(numeroDoEstoque().className).toContain(VERMELHO);
    });

    // O cartão detalhado mostra os dois selos hoje; só o compacto é regra.
    it.skipIf(viewMode !== "compact")(
      "compacto: Esgotado não ganha também o selo 'Crítico' (um selo só por produto)",
      async () => {
        montarProduto({ stock: 0, estoqueMinimo: null });
        await montar();

        expect(rotulosDeStatus()).toContain("Esgotado");
        expect(temSeloCritico()).toBe(false);
      },
    );

    it("PAUSADO com estoque abaixo do mínimo: Offline, sem selo Crítico e sem cor de alarme", async () => {
      montarProduto({ isActive: false, stock: 2, estoqueMinimo: 10 });
      await montar();

      expect(rotulosDeStatus()).toContain("Offline");
      expect(temSeloCritico()).toBe(false);
      const classe = numeroDoEstoque().className;
      expect(classe).not.toContain(AMBAR);
      expect(classe).not.toContain(VERMELHO);
    });

    it("PAUSADO com estoque 0: Offline, sem selo Crítico e número sem vermelho", async () => {
      montarProduto({ isActive: false, stock: 0, estoqueMinimo: null });
      await montar();

      expect(rotulosDeStatus()).toContain("Offline");
      expect(rotulosDeStatus()).not.toContain("Esgotado");
      expect(temSeloCritico()).toBe(false);
      expect(numeroDoEstoque().className).not.toContain(VERMELHO);
    });

    it("estoque baixo mostra o mínimo do PRÓPRIO produto ('mín. 10'), não o padrão", async () => {
      montarProduto({ stock: 8, estoqueMinimo: 10 });
      await montar();

      expect(cartao().textContent).toContain("mín. 10");
      expect(cartao().textContent).not.toContain("mín. 5");
    });

    it("estoque baixo sem mínimo cadastrado mostra o padrão ('mín. 5')", async () => {
      montarProduto({ stock: 3, estoqueMinimo: null });
      await montar();

      expect(cartao().textContent).toContain("mín. 5");
    });

    // No compacto o "mín." só aparece fora do Esgotado (e com mínimo 0 o
    // produto só é "baixo" ao zerar), então este caso só existe no detalhado.
    it.skipIf(viewMode !== "detailed")(
      "mínimo ZERO com estoque 0 mostra 'mín. 0', não vira o padrão 5",
      async () => {
        montarProduto({ stock: 0, estoqueMinimo: 0 });
        await montar();

        expect(cartao().textContent).toContain("mín. 0");
        expect(cartao().textContent).not.toContain("mín. 5");
      },
    );

    it("acima do mínimo não mostra 'mín.' nem selo Crítico", async () => {
      montarProduto({ stock: 11, estoqueMinimo: 10 });
      await montar();

      expect(temSeloCritico()).toBe(false);
      expect(cartao().textContent).not.toContain("mín.");
    });
  },
);
