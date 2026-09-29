// @vitest-environment jsdom
//
// C4.4 (achado 2 da rodada de correção, BLOQUEIA): `irParaPedidosCancelados`
// — o botão "Ver pedidos" do alerta de estorno — zerava status, pagamento,
// busca e período, mas não o `canalFilter` novo. Um chip "Balcão" deixado
// ligado numa sessão anterior sobrevive em localStorage e, no clique, filtra
// a lista de cancelados só por presencial: o pedido do SITE a estornar some
// da tela sem nenhuma pista visível — o MESMO achado que o reset de
// busca/período já existe para evitar (docstring de `irParaPedidosCancelados`
// em AdminOrdersView.tsx).
//
// Molde de setup igual a
// admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx (o dono do
// alerta "Ver pedidos"): precisa do `useAnalytics` com `paidOnCancelled`
// para o aviso aparecer, e dos stubs de matchMedia/ResizeObserver/
// IntersectionObserver que o AdminKpiCarousel (embla) exige em `active=true`.
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

function statsComUmPagoCancelado() {
  return {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 6, revenueTrend: 0, countTrend: 0 },
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
    deliveredTotal: 3,
    paidOnCancelled: 1,
  };
}

describe("AdminOrdersView — 'Ver pedidos' do alerta de estorno reseta o canal (C4.4)", () => {
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
    Element.prototype.scrollIntoView =
      vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
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

  it("chip 'Balcão' ligado numa sessão anterior: clicar em 'Ver pedidos' volta o canal para 'all'", async () => {
    mockAnalyticsStats = statsComUmPagoCancelado();
    // Sessão anterior: lojista tinha ligado o chip "Balcão" e fechado a
    // gaveta sem desligar.
    window.localStorage.setItem(
      "admin_orders_canal_filter",
      JSON.stringify("presencial"),
    );

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const alavanca = hospedeiro.querySelector<HTMLButtonElement>(
      'button[data-testid="alertas-cancelados-alavanca"]',
    );
    expect(alavanca).toBeTruthy();
    await act(async () => {
      alavanca!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Ver pedidos",
    );
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // O achado: sem o reset, esta chave continuaria '"presencial"' e o
    // pedido do SITE a estornar sumiria da lista de cancelados.
    expect(window.localStorage.getItem("admin_orders_canal_filter")).toBe(
      '"all"',
    );
  });
});
