// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O produtor useAnalytics e a tela são reais. Só rede, disco e catálogo
// alheio ao resumo são dublados; não fabricar stats modernos no hook.
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  getById: vi.fn(),
  put: vi.fn(),
  loadProducts: vi.fn(),
  produtos: [
    {
      id: "produto-fixture",
      name: "Produto fictício",
      category: "Geral",
      images: [],
      isActive: true,
      stock: 2,
      price: 15,
      costPrice: 10,
    },
  ],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "admin-fixture" } } },
      }),
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: { init: async () => ({ getById: h.getById, put: h.put }) },
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: h.produtos,
    loading: false,
    loadProducts: h.loadProducts,
    deleteProduct: vi.fn(),
    toggleProductStatus: vi.fn(),
    addProduct: vi.fn(),
    copiarImagemParaDuplicacao: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

import { clearAnalyticsCache, useAnalytics } from "@/hooks/useAnalytics";
import { AdminProductsView } from "@/views/admin/AdminProductsView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const legado = { inventory: { totalCost: 20, totalValue: 60 } };
const novo = { inventory: { ...legado.inventory, totalRevenue: 400 } };
const navegar = vi.fn();
function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("Produtos — faturamento vindo da RPC depois de cache legado", () => {
  let raiz: Root;
  let caixa: HTMLDivElement;

  // Mesmo caminho de preparação do layout: hidrata o hook antes de abrir
  // o lazy da tela Produtos. Não chama a RPC nesta etapa.
  function LayoutComCache() {
    useAnalytics();
    return null;
  }
  const tela = (active = true) => (
    <AdminProductsView onNavigate={navegar} active={active} />
  );
  const faturamento = () =>
    caixa.querySelector('[aria-label="Faturamento potencial"]')?.textContent;

  async function aquecerCache() {
    await act(async () => {
      raiz.render(<LayoutComCache />);
    });
    expect(h.getById).toHaveBeenCalledWith(
      "store_config",
      "admin_dashboard_stats",
    );
    expect(h.rpc).not.toHaveBeenCalled();
  }
  beforeEach(() => {
    clearAnalyticsCache();
    h.rpc.mockReset().mockResolvedValue({ data: novo, error: null });
    h.getById
      .mockReset()
      .mockImplementation(async (_tabela, chave) =>
        chave === "admin_dashboard_stats" ? { id: chave, data: legado } : null,
      );
    h.put.mockReset().mockResolvedValue(undefined);
    h.loadProducts
      .mockReset()
      .mockResolvedValue({ products: h.produtos, total: 1 });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
    const armazenamento = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazenamento.get(chave) ?? null,
      setItem: (chave: string, valor: string) =>
        armazenamento.set(chave, valor),
      removeItem: (chave: string) => armazenamento.delete(chave),
    });
    caixa = document.createElement("div");
    document.body.appendChild(caixa);
    raiz = createRoot(caixa);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    caixa.remove();
    clearAnalyticsCache();
    vi.unstubAllGlobals();
  });

  it("primeira abertura consulta o servidor e mostra o campo novo, não a soma da página", async () => {
    await aquecerCache();
    await act(async () => {
      raiz.render(tela());
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("get_admin_analytics_v2", {
      p_limit_days: 3650,
    });
    expect(faturamento()).toContain("400,00");
    expect(h.put).toHaveBeenCalledWith("store_config", {
      id: "admin_dashboard_stats",
      data: novo,
    });
  });

  it("mantém os números antigos enquanto espera, então troca pelo faturamento da rede", async () => {
    await aquecerCache();
    const rede = pendente<{ data: typeof novo; error: null }>();
    h.rpc.mockReturnValue(rede.promessa);
    await act(async () => {
      raiz.render(tela());
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(faturamento()).toContain("—");
    expect(
      caixa.querySelector('[aria-label="Dinheiro parado em estoque"]')
        ?.textContent,
    ).toContain("20,00");
    await act(async () => {
      rede.resolver({ data: novo, error: null });
      await rede.promessa;
    });
    expect(faturamento()).toContain("400,00");
  });

  it("aba ainda inativa só busca quando for aberta", async () => {
    await aquecerCache();
    await act(async () => {
      raiz.render(tela(false));
    });
    expect(h.rpc).not.toHaveBeenCalled();
    await act(async () => {
      raiz.render(tela());
    });
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(faturamento()).toContain("400,00");
  });

  it("leitura antiga do disco que termina depois da rede não apaga o campo novo", async () => {
    const disco = pendente<{ id: string; data: typeof legado }>();
    h.getById.mockImplementation(async (_tabela, chave) =>
      chave === "admin_dashboard_stats" ? disco.promessa : null,
    );
    await act(async () => {
      raiz.render(tela());
    });
    expect(faturamento()).toContain("400,00");
    await act(async () => {
      disco.resolver({ id: "admin_dashboard_stats", data: legado });
      await disco.promessa;
    });
    expect(faturamento()).toContain("400,00");
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 0])(
    "resposta com faturamento %s não cria RPC em laço",
    async (valor) => {
      await aquecerCache();
      const resposta =
        valor === undefined
          ? legado
          : {
              inventory: { ...legado.inventory, totalRevenue: valor },
            };
      h.rpc.mockResolvedValue({ data: resposta, error: null });
      await act(async () => {
        raiz.render(tela());
      });
      expect(h.rpc).toHaveBeenCalledTimes(1);
      expect(faturamento()).toContain(valor === undefined ? "—" : "0,00");
      await act(async () => {
        raiz.render(tela());
      });
      await act(async () => {
        raiz.render(tela());
      });
      expect(h.rpc).toHaveBeenCalledTimes(1);
    },
  );
});
