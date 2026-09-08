// @vitest-environment jsdom
import type { DashboardStats } from "@/hooks/useAnalytics";
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stats: null as DashboardStats | null,
  receberProps: vi.fn(),
  fetchExecutiveSummary: vi.fn(),
  fetchCategoryAnalytics: vi.fn(),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: h.stats,
    // Mantém isLoading=true mesmo quando já há stats em cache.
    categoryData: null,
    error: null,
    categoryError: null,
    fetchExecutiveSummary: h.fetchExecutiveSummary,
    fetchCategoryAnalytics: h.fetchCategoryAnalytics,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { originCep: "12345-678" },
    isLoaded: true,
    products: [{ isActive: true }],
    loadingProducts: false,
  }),
}));
// A sessão nula isola este teste de RPCs, timers e canais de rede.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: null }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// Só os gráficos/carrossel são substituídos; painel, ponte e card são reais.
vi.mock("@/components/admin/dashboard/KpiSummaryCards", () => ({
  KpiSummaryCards: () => null,
}));
vi.mock("@/components/admin/dashboard/OperationalPerformanceChart", () => ({
  OperationalPerformanceChart: () => null,
}));
vi.mock("@/components/admin/dashboard/StrategicIntelligenceBlocks", () => ({
  StrategicIntelligenceBlocks: () => null,
}));
vi.mock("@/components/admin/dashboard/TopProductsList", () => ({
  TopProductsList: () => null,
}));
vi.mock(
  "@/components/admin/dashboard/LojaProntaEEstoqueBaixo",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@/components/admin/dashboard/LojaProntaEEstoqueBaixo")
      >();
    return {
      ...original,
      LojaProntaEEstoqueBaixo: (
        props: ComponentProps<typeof original.LojaProntaEEstoqueBaixo>,
      ) => {
        h.receberProps(props);
        return <original.LojaProntaEEstoqueBaixo {...props} />;
      },
    };
  },
);

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const STATS: DashboardStats = {
  today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
  month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
  executive: {
    totalRevenue: 0,
    totalOrders: 0,
    revenueTrend: 0,
    ordersTrend: 0,
    avgTicket: 0,
    avgTicketTrend: 0,
    activeCustomers: 0,
    activeCustomersTrend: 0,
  },
  revenueHistory: [],
  topProducts: [],
  inventoryAlerts: 3,
};

describe("AdminDashboardView liga o carregamento ao card de estoque", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    h.stats = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montarPainel() {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(<AdminDashboardView active={true} onNavigate={vi.fn()} />);
    });
    const sincronizar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (botao) => botao.textContent?.includes("Sincronizar"),
    );
    // Online, botão desabilitado confirma que o estado interno ainda carrega.
    expect(sincronizar?.disabled).toBe(true);
  }

  it("isLoading=true sem stats envia estoqueCarregando=true e não acusa falha", async () => {
    await montarPainel();

    expect(h.receberProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ stats: null, estoqueCarregando: true }),
    );
    expect(hospedeiro.textContent).toMatch(/conferindo estoque/i);
    expect(hospedeiro.textContent).not.toMatch(/não foi possível conferir/i);
    expect(hospedeiro.textContent).not.toMatch(/tentar de novo/i);
  });

  it("isLoading=true com stats envia estoqueCarregando=false e mantém o número", async () => {
    h.stats = STATS;
    await montarPainel();

    expect(h.receberProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ stats: STATS, estoqueCarregando: false }),
    );
    expect(hospedeiro.textContent).toContain("Estoque baixo: 3 produtos");
    expect(hospedeiro.textContent).not.toMatch(/conferindo estoque/i);
    expect(hospedeiro.textContent).not.toMatch(/não foi possível conferir/i);
  });
});
