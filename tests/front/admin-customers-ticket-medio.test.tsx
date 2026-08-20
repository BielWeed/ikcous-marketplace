// @vitest-environment jsdom
//
// Auditoria de 20/08/2026, achado 4 — o card "Ticket Médio" da tela de
// Clientes não mostrava ticket médio.
//
// PRIMEIRA CORREÇÃO (commit 402c669), incompleta
//   A conta era `global_ltv / total_customers` — receita dividida por
//   CLIENTES. Isso é gasto médio por cliente, não ticket médio. A correção
//   trocou o divisor para `global_orders`, mas manteve a BASE:
//   `get_admin_customers_paged` filtra pedidos só por `status NOT IN
//   ('cancelled','returned')`, sem olhar cobrança nenhuma. O Dashboard, via
//   `get_admin_analytics_v2`, filtra TAMBÉM por
//   `payment_status IN ('pago','pago_apos_expirar')` (ou nulo). As duas
//   contas só batiam por coincidência: quando não existia nenhum pedido
//   aguardando pagamento no banco. No primeiro PIX pendente, os dois cards
//   do mesmo painel, com o mesmo rótulo "Ticket Médio", voltavam a dizer
//   números diferentes — o mesmo defeito, com a metade errada consertada.
//
// A CORREÇÃO DESTA TAREFA
//   O card para de calcular. Passa a LER `executive.avgTicket` (via
//   `useAnalytics()`), a mesma fonte que o Dashboard e a tela de Pedidos já
//   leem. Não sobra uma segunda calculadora para desalinhar de novo.
//
//   Consequência: com `stats` ainda nulo (resumo executivo não chegou), o
//   card não pode inventar "R$ 0,00" — mostra um espaço reservado até o
//   número chegar de verdade.
//
// POR QUE ESTE TESTE MONTA A TELA
//   A leitura do valor é uma expressão dentro do `useMemo` que constrói os
//   cards. Não dá para exercitá-la sem renderizar, e é no render que ela é
//   ligada ao rótulo — que é a metade do defeito.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaRpc } = vi.hoisted(() => ({
  estadoDaRpc: {
    data: [] as unknown[],
    total_count: 0,
    stats: {
      total_customers: 16,
      global_ltv: 450.5,
      global_orders: 11,
      new_customers_30d: 0,
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

// O cache do admin devolve dados de sessões anteriores e atropelaria o
// cenário de cada teste.
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));

// `let` porque cada teste controla o que o resumo executivo "já chegou" —
// mesmo padrão de admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx.
let mockAnalyticsStats: any = null;

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: mockAnalyticsStats,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O card mora dentro do AdminKpiCarousel, que usa embla-carousel-react.
// Ele chama `matchMedia`, `ResizeObserver` e `IntersectionObserver` no mount,
// e o jsdom deste projeto não traz nenhum dos três. Sem os dublês o carrossel
// estoura DENTRO do LocalErrorBoundary, os KPIs somem do DOM e o teste fica
// vermelho por ausência de conteúdo — parecendo defeito do valor quando é
// defeito do ambiente. Mesmo padrão de
// `admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx`.
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

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Monta o `stats` que `useAnalytics()` devolveria — só os campos que este
 * card lê importam para o teste, o resto é preenchimento neutro para bater
 * com o tipo `DashboardStats`. */
function analyticsStatsFake(avgTicket: number) {
  return {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue: 0,
      totalOrders: 0,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    revenueHistory: [],
    topProducts: [],
    inventoryAlerts: 0,
    averageTicket: avgTicket,
  };
}

describe("AdminCustomersView — o card Ticket Médio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // O jsdom deste ambiente não traz localStorage utilizável, e a tela lê
    // `admin_customers_view_mode` no initializer do estado. Mesmo dublê em
    // Map que `admin-orders-payment-filter.test.tsx` já usa. Sem ele o teste
    // fica vermelho por `localStorage.getItem is not a function` — vermelho
    // pelo motivo errado, que não prova nada sobre o defeito.
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
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    estadoDaRpc.stats = {
      total_customers: 16,
      global_ltv: 450.5,
      global_orders: 11,
      new_customers_30d: 0,
    };
    mockAnalyticsStats = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminCustomersView } = await import(
      "@/views/admin/AdminCustomersView"
    );
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    // O fetch da lista é disparado por um timer de 320 ms dentro da view.
    await act(async () => {
      await esperar(400);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  it("lê o ticket médio da mesma fonte que o Dashboard, não calcula a partir de global_ltv/global_orders (cenário do PIX pendente)", async () => {
    // Um pedido de R$ 89,90 aguardando pagamento: entra na base de
    // `get_admin_customers_paged` (que não filtra cobrança) mas fica de
    // fora do `executive.avgTicket` (que filtra). Se a tela ainda
    // calculasse localmente, R$ 540,40 ÷ 12 pedidos = R$ 45,03 — o número
    // que ela mostrava antes desta correção. Lendo da fonte compartilhada,
    // o pedido pendente não entra, e o card bate com o Dashboard: R$ 40,95.
    estadoDaRpc.stats = {
      total_customers: 16,
      global_ltv: 540.4, // 450,50 + 89,90 do PIX pendente
      global_orders: 12, // 11 + o pedido pendente
      new_customers_30d: 0,
    };
    mockAnalyticsStats = analyticsStatsFake(40.95); // sem o pedido pendente

    await abrirTela();

    expect(texto()).toContain("R$ 40,95");
    // O número que a conta local (abandonada) daria com estes dados.
    expect(texto()).not.toContain("R$ 45,03");
    // O número que a conta local mais antiga (dividir por clientes) daria.
    expect(texto()).not.toContain("R$ 33,78"); // 540,40 ÷ 16
  });

  it("enquanto o resumo executivo não chegou, mostra um espaço reservado — nunca R$ 0,00", async () => {
    mockAnalyticsStats = null;

    await abrirTela();

    expect(texto()).toContain("—");
    expect(texto()).not.toContain("R$ 0,00");
  });

  it("loja sem nenhum pedido: avgTicket medido como 0 aparece como R$ 0,00, porque foi medido", async () => {
    estadoDaRpc.stats = {
      total_customers: 5,
      global_ltv: 0,
      global_orders: 0,
      new_customers_30d: 0,
    };
    mockAnalyticsStats = analyticsStatsFake(0);

    await abrirTela();

    expect(texto()).toContain("R$ 0,00");
    expect(texto()).not.toMatch(/NaN|Infinity/);
  });

  it("resumo em cache SEM o bloco executivo tambem mostra o traco, nao R$ 0,00", async () => {
    // O hook restaura o resumo de um cache em disco (DataVault). Esse cache
    // pode ter sido gravado por uma versao anterior do payload, sem o bloco
    // `executive`. Aqui `analyticsStats` EXISTE — entao a guarda de "ainda
    // nao chegou" nao pega — mas nao ha ticket medio nenhum dentro dele.
    // Com uma cadeia terminando em `|| 0`, isto imprimiria "R$ 0,00" e
    // afirmaria que a loja tem ticket medio zero.
    mockAnalyticsStats = {
      today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
      month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    } as unknown as typeof mockAnalyticsStats;

    await abrirTela();

    expect(texto()).toContain("—");
    expect(texto()).not.toContain("R$ 0,00");
  });

  it("o rótulo de apoio descreve a média por pedido, não por cliente", async () => {
    mockAnalyticsStats = analyticsStatsFake(40.95);

    await abrirTela();

    expect(texto()).toMatch(/por pedido/i);
    expect(texto()).not.toMatch(/consumo médio/i);
  });
});
