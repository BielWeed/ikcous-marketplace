// @vitest-environment jsdom
//
// Segunda metade do achado 10 da auditoria de 20/08/2026: o cartão "Ações
// Pendentes" trocava o subtítulo entre "Urgente" (stats.pending > 0) e
// "Limpo" (=== 0). Um pedido em "Em Separação" parado desde 24/03/2026
// deixava "Urgente" aceso por cinco meses seguidos — um alarme que nunca
// apaga deixa de ser lido no dia em que significar alguma coisa.
//
// A correção: o subtítulo passa a descrever O QUE o número conta, e isso é
// sempre verdade, então nunca muda com o valor de `stats.pending`. Este
// teste prova as duas pontas: com `pending = 0` (não pode mais dizer
// "Limpo") e com `pending > 0` (não pode mais dizer "Urgente").
//
// Segue o mesmo padrão de mock de
// admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// A-3 (laudo varredura 01/09): AdminOrdersView passou a ler o nome da loja
// (config.storeName) para o recibo impresso — mock mínimo do contexto, mesmo
// padrão de admin-coupons-view-expirado.test.tsx. Sem ele o useStore lança
// 'must be used within a StoreProvider' em toda montagem da view.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

let mockOrders: Order[] = [];
let mockTotalOrders = 0;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    totalOrders: mockTotalOrders,
    isLoaded: true,
    loading: false,
  }),
}));

let mockAnalyticsStats: any = null;

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: mockAnalyticsStats,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
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

function statsFake(pending: number) {
  return {
    today: {
      revenue: 0,
      count: 0,
      pending,
      revenueTrend: 0,
      countTrend: 0,
    },
    month: {
      revenue: 0,
      count: 0,
      revenueTrend: 0,
      countTrend: 0,
    },
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
    inventoryAlerts: 0,
    deliveredTotal: 0,
    paidOnCancelled: 0,
  };
}

describe("AdminOrdersView — subtítulo de 'Ações Pendentes' não inventa 'Urgente'/'Limpo'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    mockOrders = [];
    mockTotalOrders = 0;
    mockAnalyticsStats = null;
  });

  it("com pending = 0, não escreve 'Limpo'", async () => {
    mockAnalyticsStats = statsFake(0);

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const rotulo = Array.from(hospedeiro.querySelectorAll("p")).find(
      (p) => p.textContent === "Ações Pendentes",
    );
    expect(rotulo).toBeTruthy();
    const cartao = rotulo!.parentElement!.parentElement!;
    expect(cartao.textContent).not.toContain("Limpo");
  });

  it("com pending = 7, não escreve 'Urgente'", async () => {
    mockAnalyticsStats = statsFake(7);

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const rotulo = Array.from(hospedeiro.querySelectorAll("p")).find(
      (p) => p.textContent === "Ações Pendentes",
    );
    expect(rotulo).toBeTruthy();
    const cartao = rotulo!.parentElement!.parentElement!;
    expect(cartao.textContent).not.toContain("Urgente");
  });

  it("o subtítulo é o MESMO texto com pending = 0 e com pending = 7 (não inventa prazo)", async () => {
    mockAnalyticsStats = statsFake(0);
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const subValueDe = () => {
      const rotulo = Array.from(hospedeiro.querySelectorAll("p")).find(
        (p) => p.textContent === "Ações Pendentes",
      );
      const cartao = rotulo!.parentElement!.parentElement!;
      // O subtítulo é o outro <p> do cartão, o que não é o rótulo nem o
      // valor numérico (h3).
      const paragrafos = Array.from(cartao.querySelectorAll("p")).map(
        (p) => p.textContent,
      );
      return paragrafos.find((texto) => texto !== "Ações Pendentes");
    };

    const subtituloComZero = subValueDe();
    expect(subtituloComZero).toBeTruthy();
    expect(subtituloComZero).not.toMatch(/mês|meses|dia|dias|há\s/i);

    mockAnalyticsStats = statsFake(7);
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(subValueDe()).toBe(subtituloComZero);
  });
});
