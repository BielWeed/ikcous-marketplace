// @vitest-environment jsdom
//
// Caça por mutação na lista de Clientes do painel (24/11/2026). Quatro regras
// da tela podiam ser trocadas sem nenhum teste cair:
//   - "Novos cadastros (30 dias)" lê os cadastros novos, não o total de contas;
//   - "Valor médio por venda": o número medido da loja vence, e uma média
//     MEDIDA em zero (há pedidos, o valor médio é R$ 0,00) aparece como
//     R$ 0,00 — só a falta de medida vira traço;
//   - a lista abre COMPACTA quando o aparelho não lembra nada (ou lembra lixo)
//     e abre DETALHADA só quando o aparelho lembra "detailed".
// Só fixtures inventadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaRpc } = vi.hoisted(() => ({
  estadoDaRpc: {
    data: [
      {
        id: "cli-1",
        email: "cli-1@fixture.invalid",
        full_name: "Cliente de Teste",
        phone: null,
        role: "customer",
        created_at: "2026-10-01T12:00:00Z",
        orders_count: 1,
        total_spent: 50,
      },
    ] as unknown[],
    total_count: 1,
    stats: {
      total_customers: 20,
      global_ltv: 450.5,
      global_orders: 11,
      new_customers_30d: 7,
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: estadoDaRpc, error: null }),
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));

let estatisticas: unknown = null;
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: estatisticas,
    error: null,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

/** O que `useAnalytics()` devolveria; só os campos que o cartão lê importam. */
function resumo(
  executive: { totalOrders: number; avgTicket: number },
  averageTicket?: number,
) {
  return {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue: 0,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
      ...executive,
    },
    revenueHistory: [],
    topProducts: [],
    inventoryAlerts: 0,
    ...(averageTicket === undefined ? {} : { averageTicket }),
  };
}

describe("AdminCustomersView — cartões do topo e modo de exibição", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let modoSalvo: string | null;

  beforeEach(() => {
    vi.clearAllMocks();
    estatisticas = null;
    modoSalvo = null;
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) =>
        chave === "admin_customers_view_mode" ? modoSalvo : null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function abrirTela() {
    const { AdminCustomersView } = await import(
      "@/views/admin/AdminCustomersView"
    );
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    // A lista sai de um timer de 320 ms dentro da tela.
    await act(async () => {
      await esperar(400);
    });
  }

  const cartao = (rotulo: string) =>
    hospedeiro.querySelector(`[aria-label="${rotulo}"]`)?.textContent ?? "";

  it("'Novos cadastros (30 dias)' mostra os cadastros novos e 'Total Clientes' mostra o total", async () => {
    await abrirTela();

    // O número vem colado no texto vizinho ("dias7Crescimento"): a conferência
    // é "7 sem outro dígito ao lado", não fronteira de palavra.
    expect(cartao("Novos cadastros (30 dias)")).toMatch(/(?<![0-9])7(?![0-9])/);
    expect(cartao("Novos cadastros (30 dias)")).not.toMatch(
      /(?<![0-9])20(?![0-9])/,
    );
    expect(cartao("Total Clientes")).toMatch(/(?<![0-9])20(?![0-9])/);
    expect(cartao("Total Clientes")).not.toMatch(/(?<![0-9])7(?![0-9])/);
  });

  it("o valor médio MEDIDO da loja vence o do resumo executivo quando os dois existem", async () => {
    estatisticas = resumo({ totalOrders: 4, avgTicket: 70 }, 50);
    await abrirTela();

    expect(cartao("Valor médio por venda")).toContain("R$ 50,00");
    expect(cartao("Valor médio por venda")).not.toContain("R$ 70,00");
  });

  it("sem o valor médio medido, usa o do resumo executivo", async () => {
    estatisticas = resumo({ totalOrders: 4, avgTicket: 70 });
    await abrirTela();

    expect(cartao("Valor médio por venda")).toContain("R$ 70,00");
  });

  it("média medida em ZERO com pedidos na loja aparece como R$ 0,00, nunca como traço", async () => {
    estatisticas = resumo({ totalOrders: 3, avgTicket: 0 }, 0);
    await abrirTela();

    expect(cartao("Valor médio por venda")).toContain("R$ 0,00");
    expect(cartao("Valor médio por venda")).not.toContain("—");
  });

  it("sem lembrança no aparelho, a lista abre compacta (sem cabeçalhos de coluna)", async () => {
    modoSalvo = null;
    await abrirTela();

    expect(hospedeiro.textContent).toContain("Cliente de Teste");
    expect(hospedeiro.textContent).not.toContain("Contato / Tipo de conta");
  });

  it("com lixo guardado no aparelho, a lista também abre compacta", async () => {
    modoSalvo = "tabela-esquisita";
    await abrirTela();

    expect(hospedeiro.textContent).toContain("Cliente de Teste");
    expect(hospedeiro.textContent).not.toContain("Contato / Tipo de conta");
  });

  it("lembrando 'detailed', a lista abre detalhada (com cabeçalhos de coluna)", async () => {
    modoSalvo = "detailed";
    await abrirTela();

    expect(hospedeiro.textContent).toContain("Contato / Tipo de conta");
  });
});
