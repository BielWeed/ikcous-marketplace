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
    caixa.querySelector('[aria-label="Receita bruta potencial"]')?.textContent;

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
      caixa.querySelector('[aria-label="Custo conhecido em estoque"]')
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

  const metrica = (rotulo: string) =>
    caixa.querySelector(`[aria-label="${rotulo}"]`)?.textContent ?? "";

  async function mostrarInventario(inventory: Record<string, number>) {
    h.rpc.mockResolvedValue({ data: { inventory }, error: null });
    await act(async () => raiz.render(tela()));
    const expandir = [...caixa.querySelectorAll("button")].find((botao) =>
      botao.textContent?.includes("Expandir"),
    );
    expect(expandir).toBeDefined();
    await act(async () => expandir!.click());
  }

  it("separa receita total, custo e lucro bruto parcial sem inventar lucro líquido", async () => {
    await mostrarInventario({
      totalCost: 100,
      totalValue: 160,
      totalRevenue: 460,
      revenueWithoutCost: 300,
      productsWithoutCost: 1,
      productsWithCost: 1,
    });
    expect(metrica("Receita bruta potencial")).toContain("460,00");
    expect(metrica("Custo conhecido em estoque")).toContain("100,00");
    expect(metrica("Lucro bruto potencial")).toContain("60,00");
    expect(metrica("Lucro bruto potencial")).toContain("Parcial");
    expect(metrica("Lucro líquido potencial")).toContain("Não calculado");
    expect(metrica("Lucro líquido potencial")).not.toContain("360,00");
    expect(caixa.textContent).toContain("300,00");
    expect(caixa.textContent).toContain("fora do custo e do lucro");
    expect(caixa.textContent).toContain("160,00");
    expect(caixa.textContent).toContain("taxas");
    expect(caixa.textContent).not.toContain("Lucro se vender tudo");
  });

  it.each([
    { totalCost: 100, totalValue: 160, totalRevenue: 160, bruto: "60,00" },
    { totalCost: 100, totalValue: 60, totalRevenue: 60, bruto: "-40,00" },
    { totalCost: 0, totalValue: 60, totalRevenue: 60, bruto: "60,00" },
    { totalCost: 0, totalValue: 0, totalRevenue: 0, bruto: "0,00" },
  ])(
    "custo zero conhecido e prejuízo não são confundidos com dado ausente: $bruto",
    async ({ bruto, ...inventory }) => {
      await mostrarInventario({
        ...inventory,
        revenueWithoutCost: 0,
        productsWithoutCost: 0,
        productsWithCost: inventory.totalRevenue === 0 ? 0 : 1,
      });
      expect(metrica("Lucro bruto potencial")).toContain(bruto);
      expect(metrica("Lucro bruto potencial")).not.toContain("Parcial");
      expect(metrica("Lucro líquido potencial")).toContain("Não calculado");
      expect(caixa.textContent).toContain(
        "Todos os produtos em estoque têm custo cadastrado",
      );
    },
  );

  it("estoque inteiro sem custo não vira lucro bruto zero conhecido", async () => {
    await mostrarInventario({
      totalCost: 0,
      totalValue: 0,
      totalRevenue: 300,
      revenueWithoutCost: 300,
      productsWithoutCost: 1,
      productsWithCost: 0,
    });
    expect(metrica("Lucro bruto potencial")).toContain("—");
    expect(metrica("Lucro sobre o custo")).toContain("—");
    expect(caixa.textContent).toContain(
      "Nenhum custo cadastrado para o estoque",
    );
  });

  it("custo e preço zero medidos não viram ausência quando outro produto está sem custo", async () => {
    await mostrarInventario({
      totalCost: 0,
      totalValue: 0,
      totalRevenue: 300,
      revenueWithoutCost: 300,
      productsWithoutCost: 1,
      productsWithCost: 1,
    });
    expect(metrica("Lucro bruto potencial")).toContain("0,00");
    expect(metrica("Lucro bruto potencial")).toContain("Parcial");
    expect(caixa.textContent).not.toContain("Nenhum custo cadastrado");
  });

  it("guia e simulador não chamam preço menos custo de lucro líquido", async () => {
    await mostrarInventario({
      totalCost: 100,
      totalValue: 160,
      totalRevenue: 160,
      revenueWithoutCost: 0,
      productsWithoutCost: 0,
      productsWithCost: 1,
    });
    const guia = caixa.querySelector<HTMLButtonElement>(
      'button[title="Guia Completo de Métricas e Ajuda"]',
    );
    expect(guia).not.toBeNull();
    await act(async () => guia!.click());
    const simulador = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Simulador",
    );
    expect(simulador).toBeDefined();
    await act(async () => simulador!.click());
    expect(document.body.textContent).toContain("Lucro bruto por unidade");
    expect(document.body.textContent).not.toContain("Lucro Líquido (Unit.)");
    expect(document.body.textContent).not.toContain("prejuízo líquido");
  });

  it("resumo legado ou contraditório não comprova lucro bruto correto", async () => {
    await mostrarInventario({
      totalCost: 100,
      totalValue: 160,
      totalRevenue: 460,
    });
    expect(metrica("Lucro bruto potencial")).toContain("—");
    expect(caixa.textContent).toContain("Aguardando a separação");
    h.rpc.mockResolvedValue({
      data: {
        inventory: {
          totalCost: 100,
          totalValue: 160,
          totalRevenue: 460,
          revenueWithoutCost: 100,
          productsWithoutCost: 1,
        },
      },
      error: null,
    });
    clearAnalyticsCache();
    await act(async () => raiz.render(null));
    await act(async () => raiz.render(tela()));
    expect(metrica("Lucro bruto potencial")).toContain("—");
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
