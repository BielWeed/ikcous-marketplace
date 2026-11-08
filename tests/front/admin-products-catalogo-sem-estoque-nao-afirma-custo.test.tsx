// @vitest-environment jsdom
//
// Tela Produtos numa loja sem nenhum produto com estoque (catálogo vazio, ou
// tudo esgotado/pausado): o resumo chega com 0 produtos com custo e 0 sem
// custo. A nota dizia em verde "Todos os produtos em estoque têm custo
// cadastrado" (não há produto nenhum para ter custo) e os cartões mostravam
// R$ 0,00 como se fosse medição. Agora a nota é neutra, a folha diz que não há
// o que calcular e os cartões mostram "—". Com estoque (custo completo ou
// parcial) nada muda.
//
// Monta `AdminProductsView` de verdade (createRoot + act); só os hooks de
// dados são dublados.
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stats: null as any,
  fetchExecutiveSummary: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts: vi.fn().mockResolvedValue({ products: [], total: 0 }),
    loadProductsSemCusto: vi.fn().mockResolvedValue({ products: [], total: 0 }),
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: h.stats,
    fetchExecutiveSummary: h.fetchExecutiveSummary,
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

const TEXTO_VERDE = "Todos os produtos em estoque têm custo cadastrado";

const resumo = (inventory: Record<string, number>) => ({ inventory });
const SEM_ESTOQUE = resumo({
  totalCost: 0,
  totalValue: 0,
  totalRevenue: 0,
  revenueWithoutCost: 0,
  productsWithoutCost: 0,
  productsWithCost: 0,
});
const COM_CUSTO = resumo({
  totalCost: 24,
  totalValue: 60,
  totalRevenue: 60,
  revenueWithoutCost: 0,
  productsWithoutCost: 0,
  productsWithCost: 3,
});

describe("Produtos sem nenhum produto com estoque", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("admin_products_view_mode", "detailed");
    h.fetchExecutiveSummary.mockResolvedValue(null);
    Element.prototype.scrollIntoView =
      vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
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

  async function montar(stats: unknown) {
    h.stats = stats;
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      raiz.render(<AdminProductsView onNavigate={vi.fn()} active />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 360));
    });
    // Resumo aberto: os seis cartões aparecem como `article`.
    const expandir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Expandir"),
    );
    expect(expandir).toBeDefined();
    await act(async () => expandir!.click());
  }
  const metrica = (rotulo: string) =>
    hospedeiro.querySelector(`[aria-label="${rotulo}"]`)?.textContent ?? "";
  async function abrirValores() {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Entender valores",
    );
    expect(botao).toBeDefined();
    await act(async () => botao!.click());
  }

  it("a nota não afirma em verde que todos têm custo, e a folha diz que não há o que calcular", async () => {
    await montar(SEM_ESTOQUE);
    expect(hospedeiro.textContent).not.toContain(TEXTO_VERDE);
    expect(hospedeiro.textContent).toContain(
      "Nenhum produto com estoque ainda",
    );
    expect(hospedeiro.querySelector(".text-emerald-300")).toBeNull();
    await abrirValores();
    expect(document.body.textContent).not.toContain(TEXTO_VERDE);
    expect(document.body.textContent).toContain(
      "Nenhum produto com estoque para calcular",
    );
  });

  it("os cartões mostram '—' e nunca R$ 0,00 como se fosse medição", async () => {
    await montar(SEM_ESTOQUE);
    for (const rotulo of [
      "Custo conhecido em estoque",
      "Lucro bruto potencial",
      "Venda prevista (com custo)",
      "Lucro sobre o custo",
    ]) {
      expect(metrica(rotulo)).toContain("—");
      expect(metrica(rotulo)).not.toContain("0,00");
    }
    await abrirValores();
    // "Venda de todo o estoque" também é medição de estoque que não existe.
    const venda = document.body.querySelector(
      '[aria-label="Receita bruta potencial"]',
    );
    expect(venda?.textContent).toContain("—");
    expect(venda?.textContent).not.toContain("0,00");
  });

  it.each([
    ["sem estoque", SEM_ESTOQUE, "Cadastre um produto com estoque"],
    [
      "sem custo",
      resumo({
        totalCost: 0,
        totalValue: 0,
        totalRevenue: 60,
        revenueWithoutCost: 60,
        productsWithoutCost: 3,
        productsWithCost: 0,
      }),
      "Cadastre o custo dos produtos",
    ],
  ])(
    "%s: o cartão não pede despesas e a folha explica o que falta",
    async (_, stats, orientacao) => {
      await montar(stats);
      const cartao = hospedeiro.querySelector(
        '[aria-label="Lucro líquido potencial"]',
      );
      expect(cartao?.textContent).toContain(orientacao);
      expect(cartao?.textContent).not.toContain("Informar despesas");
      expect(cartao?.querySelector("button")).toBeNull();
      await abrirValores();
      expect(document.body.textContent).toContain(
        `${orientacao} para calcular o líquido.`,
      );
      expect(document.body.textContent).not.toContain("Aguarde os custos");
    },
  );

  it("com estoque e custo completo o aviso verde e os valores continuam iguais", async () => {
    await montar(COM_CUSTO);
    expect(hospedeiro.textContent).toContain(TEXTO_VERDE);
    expect(hospedeiro.textContent).not.toContain(
      "Nenhum produto com estoque ainda",
    );
    expect(metrica("Custo conhecido em estoque")).toContain("24,00");
    expect(metrica("Lucro bruto potencial")).toContain("36,00");
    expect(metrica("Venda prevista (com custo)")).toContain("60,00");
    await abrirValores();
    expect(document.body.textContent).toContain(TEXTO_VERDE);
    expect(document.body.textContent).not.toContain(
      "Nenhum produto com estoque para calcular",
    );
  });
});
