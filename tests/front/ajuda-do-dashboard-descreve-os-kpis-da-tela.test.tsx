// @vitest-environment jsdom
//
// Lote 1 do laudo "o que falta" (29/08, achado banners 13): a "Central de
// Inteligência & KPIs" (o modal de ajuda do dashboard) documentava
// "Capital Alocado", "Lucro Potencial" e "Faturamento" como indicadores da
// tela — mas os cartões reais eram "Volume Total", "Total de Pedidos",
// "Ticket Médio" e "Clientes Únicos" (o carrossel "Métricas principais",
// KpiSummaryCards.tsx). Um nome em quatro batia. O lojista lia a ajuda e
// procurava números que não existem.
//
// 28/09/2026: o próprio carrossel saiu da tela (pedido do dono — duplicava
// os 8 números do período que já aparecem no topo da Visão geral). A ajuda
// tem que acompanhar: agora ela NÃO PODE mais prometer os 4 CARTÕES que o
// carrossel mostrava ("Volume Total", "Total de Pedidos", "Ticket Médio",
// "Clientes Únicos") — esses cartões, específicos, não existem mais. As
// PALAVRAS "Pedidos"/"Ticket Médio" continuam na tela em outro contexto
// (a linha de resumo do bloco Performance, "Pedidos: N" / "Ticket Médio:
// R$ X" — OperationalPerformanceChart, mocado para null neste teste, por
// isso a asserção abaixo não precisa excluir essas palavras soltas, só as
// frases exatas dos 4 cartões removidos). Continua sem os três fantasmas
// originais, que nunca existiram.
//
// Os filhos com gráfico são dublados: o assunto deste teste é o TEXTO da
// ajuda, não o desenho — recharts em jsdom é ruído caro para nada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STATS = {
  today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
  month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
  executive: {
    totalRevenue: 1234.56,
    totalOrders: 7,
    revenueTrend: 0,
    ordersTrend: 0,
    avgTicket: 176.37,
    avgTicketTrend: 0,
    activeCustomers: 5,
    activeCustomersTrend: 0,
  },
  revenueHistory: [],
  topProducts: [],
  inventoryAlerts: 0,
} as any;

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn(),
    fetchCategoryAnalytics: vi.fn(),
    stats: STATS,
    categoryData: [],
    error: null,
    categoryError: null,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "adm-1" } }, isAdmin: true }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    // `crm_visao` (números do período) responde vazio: o assunto é a ajuda.
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => {
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn(),
  },
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms — ` +
          `texto do corpo: ${(document.body.textContent ?? "").slice(0, 300)}`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

describe("A ajuda do dashboard (hoje no Dashboard CRM) documenta os KPIs que a tela realmente tem", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("o modal de ajuda descreve exatamente os cards que a tela tem — sem o carrossel removido, sem fantasma", async () => {
    const { AdminCrmView } = await import("@/views/admin/AdminCrmView");
    await act(async () => {
      raiz.render(<AdminCrmView active={true} onNavigate={() => {}} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const botaoAjuda = hospedeiro.querySelector(
      'button[title="Guia de Ajuda e Informações"]',
    ) as HTMLButtonElement | null;
    expect(botaoAjuda).toBeTruthy();
    await act(async () => {
      botaoAjuda!.click();
    });
    // O modal é portal + estado do React: espera o título dele existir no
    // DOM em vez de dormir um tick fixo.
    await esperarAte(
      () =>
        document.body.textContent?.includes("Central de Inteligência") ?? false,
    );

    const texto = document.body.textContent ?? "";

    // O que sobrou do Histórico completo (Divisão de faturamento,
    // Performance, Top 5) continua descrito.
    for (const blocoReal of [
      "Performance Operacional",
      "Inteligência Estratégica por Categoria",
      "Produtos Mais Lucrativos",
    ]) {
      expect(texto).toContain(blocoReal);
    }

    // O carrossel "Métricas principais" saiu da tela (28/09/2026) — a ajuda
    // não pode mais prometer estes 4 cartões, que não existem em lugar
    // nenhum do Dashboard CRM.
    for (const kpiRemovido of [
      "Volume Total",
      "Total de Pedidos",
      "Ticket Médio",
      "Clientes Únicos",
    ]) {
      expect(texto).not.toContain(kpiRemovido);
    }
    // Os três fantasmas originais: indicadores que a tela NUNCA teve e a
    // ajuda ensinava. O "Faturamento" com letra maiúscula é a marca do
    // cartão fantasma — em minúsculo, a palavra é texto comum de outras
    // seções.
    expect(texto).not.toContain("Capital Alocado");
    expect(texto).not.toContain("Lucro Potencial");
    expect(texto).not.toContain("Faturamento");
  });
});
