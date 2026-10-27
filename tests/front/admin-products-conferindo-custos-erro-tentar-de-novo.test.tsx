// @vitest-environment jsdom
//
// Caça 9, item 10 — "Conferindo custos…" ficava para sempre quando o resumo
// financeiro falhava: a tela nunca lia o `error` do `useAnalytics`, então não
// distinguia "ainda buscando" de "a busca falhou". Agora a falha aparece com
// um "Tentar de novo" que busca o resumo de novo.
//
// Monta `AdminProductsView` de verdade; só os hooks de dados são dublados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stats: null as any,
  error: null as string | null,
  offline: false,
  fetchExecutiveSummary: vi.fn(),
  loadProducts: vi.fn(),
}));
const onNavigate = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
    loading: false,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    loadProducts: h.loadProducts,
    loadProductsSemCusto: vi.fn(),
    copiarImagemParaDuplicacao: async (url: string) => url,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: h.stats,
    error: h.error,
    fetchExecutiveSummary: h.fetchExecutiveSummary,
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
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

const RESUMO_COMPLETO = {
  inventory: {
    totalCost: 24,
    totalValue: 60,
    totalRevenue: 60,
    revenueWithoutCost: 0,
    productsWithoutCost: 0,
    productsWithCost: 3,
  },
};
// Resumo guardado por uma versão antiga: não prova a cobertura do custo.
const RESUMO_ANTIGO = { inventory: { totalCost: 1, totalValue: 1 } };

function botaoTentar(raizDom: ParentNode) {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Tentar de novo"),
  ) as HTMLButtonElement | undefined;
}

describe("AdminProductsView — resumo de custos que falhou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.stats = null;
    h.error = null;
    h.offline = false;
    h.fetchExecutiveSummary.mockResolvedValue(null);
    h.loadProducts.mockResolvedValue({ products: [], total: 0 });
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

  async function montar() {
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

  it("ainda buscando (sem erro): continua 'Conferindo custos…' e não oferece tentar de novo", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain("Conferindo custos…");
    expect(botaoTentar(hospedeiro)).toBeUndefined();
  });

  it("a busca falhou (sem resumo nenhum): diz que não deu e oferece 'Tentar de novo', que busca de novo", async () => {
    h.error = "Não foi possível carregar o resumo do painel agora.";
    await montar();

    expect(hospedeiro.textContent).not.toContain("Conferindo custos…");
    expect(hospedeiro.textContent).toContain("Custos não conferidos");
    const tentar = botaoTentar(hospedeiro);
    expect(tentar).toBeDefined();
    expect(tentar!.disabled).toBe(false);

    h.fetchExecutiveSummary.mockClear();
    await act(async () => {
      tentar!.click();
    });
    expect(h.fetchExecutiveSummary).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("a busca falhou e havia um resumo ANTIGO guardado: também mostra o erro, não 'Conferindo' para sempre", async () => {
    h.stats = RESUMO_ANTIGO;
    h.error = "Não foi possível carregar o resumo do painel agora.";
    await montar();
    expect(hospedeiro.textContent).not.toContain("Conferindo custos…");
    expect(botaoTentar(hospedeiro)).toBeDefined();
  });

  it("ao tentar de novo o erro some e volta o 'Conferindo custos…' enquanto busca", async () => {
    h.error = "Não foi possível carregar o resumo do painel agora.";
    await montar();
    expect(botaoTentar(hospedeiro)).toBeDefined();

    // O hook limpa o erro ao começar a nova busca.
    h.error = null;
    const { AdminProductsView } = await import(
      "@/views/admin/AdminProductsView"
    );
    await act(async () => {
      // `visaoInicial` desconhecida é ignorada pela tela; só força o redesenho
      // (a tela é `memo` e os dublês dos hooks não avisam mudança sozinhos).
      raiz.render(
        <AdminProductsView
          onNavigate={onNavigate}
          active={true}
          visaoInicial="redesenhar"
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("Conferindo custos…");
    expect(botaoTentar(hospedeiro)).toBeUndefined();
  });

  it("resumo completo + aviso de atualização que falhou: nada de erro (os números são verdadeiros)", async () => {
    h.stats = RESUMO_COMPLETO;
    h.error =
      "Não foi possível atualizar agora — exibindo a última atualização.";
    await montar();
    expect(hospedeiro.textContent).toContain(
      "Todos os produtos em estoque têm custo cadastrado.",
    );
    expect(hospedeiro.textContent).not.toContain("Custos não conferidos");
    expect(botaoTentar(hospedeiro)).toBeUndefined();
  });

  it("sem internet o 'Tentar de novo' fica desligado (não adianta tentar)", async () => {
    h.error = "Não foi possível carregar o resumo do painel agora.";
    h.offline = true;
    await montar();
    const tentar = botaoTentar(hospedeiro);
    expect(tentar).toBeDefined();
    expect(tentar!.disabled).toBe(true);
  });
});
