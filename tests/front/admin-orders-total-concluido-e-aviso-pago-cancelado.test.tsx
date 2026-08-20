// @vitest-environment jsdom
//
// Dois defeitos na tela de Pedidos do admin:
//
// 1. O cartão "Total Concluído" usava `analyticsStats.month.count` — a
//    contagem de TODOS os pedidos não cancelados dos últimos 30 dias,
//    inclusive os que nunca saíram de "Novo Pedido". O filtro "Finalizado",
//    a poucos centímetros do cartão, devolve um número diferente. Prova:
//    com `month.count=6` e `deliveredTotal=3`, o cartão mostra 3.
// 2. Pedido pago depois de cancelado (`payment_status='pago_apos_expirar'`
//    + `status='cancelled'`) não tinha nenhum aviso fixo na tela — só uma
//    etiqueta no cartão da lista, que rola para fora de vista conforme
//    chegam pedidos novos. Prova: com `paidOnCancelled=1`, aparece um aviso
//    fixo com o texto certo e um botão que filtra a lista para esses
//    pedidos (grava em localStorage, já que é isso que `useLocalStorage`
//    faz de fato).
//
// Segue o mesmo padrão de mock de admin-orders-payment-filter.test.tsx:
// `@/lib/supabase` mocado porque AdminOrdersView.tsx importa `supabase` no
// topo (usado no fetch de pedido avulso por deep link) — sem o mock, só
// IMPORTAR o módulo já dispara a leitura de env vars que não existem aqui.
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

// `let` porque cada teste controla o que a RPC "devolveu".
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

// embla-carousel-react (usado pelo AdminKpiCarousel) usa ResizeObserver e
// IntersectionObserver internamente — ausentes no jsdom deste projeto.
// Mesmo padrão de premium-offers-gate-avaliacoes.test.tsx.
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

function statsFake(overrides: {
  monthCount: number;
  deliveredTotal?: number;
  paidOnCancelled?: number;
}) {
  return {
    today: {
      revenue: 0,
      count: 0,
      pending: 0,
      revenueTrend: 0,
      countTrend: 0,
    },
    month: {
      revenue: 0,
      count: overrides.monthCount,
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
    deliveredTotal: overrides.deliveredTotal,
    paidOnCancelled: overrides.paidOnCancelled,
  };
}

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` em
 * vez de dormir um tempo fixo — mesmo helper de
 * checkout-summary-bar.test.tsx, sem `@testing-library/react` (não
 * instalado neste projeto). */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

describe("AdminOrdersView — Total Concluído e aviso de pago após cancelado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // jsdom deste ambiente não traz localStorage utilizável, mesmo dublê em
    // Map usado em admin-orders-payment-filter.test.tsx.
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
    // AdminKpiCarousel usa embla-carousel-react, que chama
    // `window.matchMedia` direto no mount — o jsdom deste projeto não
    // implementa isso, e sem o stub o carrossel quebra silenciosamente
    // dentro do LocalErrorBoundary (mesmo achado documentado em
    // strategic-intelligence-error-banner.test.tsx para useMediaQuery).
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

  it("cartão 'Total Concluído' mostra deliveredTotal, não month.count", async () => {
    mockAnalyticsStats = statsFake({ monthCount: 6, deliveredTotal: 3 });

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const rotulo = Array.from(hospedeiro.querySelectorAll("p")).find(
      (p) => p.textContent === "Total Concluído",
    );
    expect(rotulo).toBeTruthy();
    const cartao = rotulo!.parentElement!.parentElement!;
    const valor = cartao.querySelector("h3")?.textContent;

    expect(valor).toBe("3");
    expect(valor).not.toBe("6");
  });

  it("sem deliveredTotal (RPC antiga), cartão mostra travessão — e não 0 (achado 3)", async () => {
    // `0` tem forma de fato: parece "zero entregues" quando na verdade é
    // "o dado ainda não chegou". O traço é o único sinal visível de que a
    // migration não subiu — inclusive de que o aviso de dinheiro preso
    // logo abaixo também pode estar apagado em silêncio.
    mockAnalyticsStats = statsFake({ monthCount: 6 });

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const rotulo = Array.from(hospedeiro.querySelectorAll("p")).find(
      (p) => p.textContent === "Total Concluído",
    );
    const cartao = rotulo!.parentElement!.parentElement!;
    expect(cartao.querySelector("h3")?.textContent).toBe("—");
    expect(cartao.querySelector("h3")?.textContent).not.toBe("0");
  });

  it("sem pedidos pagos após cancelado, nenhum aviso aparece", async () => {
    mockAnalyticsStats = statsFake({
      monthCount: 6,
      deliveredTotal: 3,
      paidOnCancelled: 0,
    });

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(hospedeiro.textContent).not.toContain(
      "recebeu pagamento e está cancelado",
    );
    expect(hospedeiro.textContent).not.toContain(
      "receberam pagamento e estão cancelados",
    );
  });

  it("com 1 pedido pago após cancelado: aviso singular, e o botão leva para cancelados sem nenhum filtro restante (achados 1 e 2)", async () => {
    mockAnalyticsStats = statsFake({
      monthCount: 6,
      deliveredTotal: 3,
      paidOnCancelled: 1,
    });
    // Uso anterior deixou busca e período no localStorage — o botão "Ver
    // pedidos" tem que limpar os dois, senão a lista de cancelados vem
    // filtrada por "maria" e aparece vazia (achado 2).
    window.localStorage.setItem(
      "admin_orders_search_query",
      JSON.stringify("maria"),
    );
    window.localStorage.setItem(
      "admin_orders_date_range",
      JSON.stringify({ start: "2026-08-01", end: "2026-08-10" }),
    );

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    // O título conta o fato que vale nas duas portas do contrato ampliado
    // da migration (pago+cancelled OU pago_apos_expirar+cancelled) — não
    // só "pago depois de cancelado", que é falso para a primeira porta.
    expect(hospedeiro.textContent).toContain(
      "1 pedido recebeu pagamento e está cancelado",
    );
    expect(hospedeiro.textContent).toContain(
      "O dinheiro entrou e o pedido está cancelado",
    );
    // Achado 4: não promete estorno que nenhuma tela do admin registra.
    expect(hospedeiro.textContent).not.toContain(
      "Ou você entrega, ou devolve o valor",
    );
    expect(hospedeiro.textContent).toContain("Mercado Pago");

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Ver pedidos",
    );
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Achado 1: o botão leva para os cancelados (o destino que dá pra
    // cumprir para as duas portas), não mais para o filtro estreito antigo.
    //
    // A chave é `admin_orders_filter_v2` desde que "Em Aberto" virou o padrão
    // da tela: a chave antiga (`admin_orders_filter`) foi aposentada de
    // propósito, para que quem já tivesse "Todos Ativos" salvo não ficasse
    // presa nele e visse a correção. O comportamento aqui não mudou — o botão
    // continua levando aos cancelados; só o nome da gaveta mudou.
    expect(window.localStorage.getItem("admin_orders_filter_v2")).toBe(
      '"cancelled"',
    );
    expect(window.localStorage.getItem("admin_orders_payment_filter")).toBe(
      '"all"',
    );
    expect(window.localStorage.getItem("admin_orders_current_page")).toBe("0");
    // Achado 2: nenhum filtro anterior sobrevive ao clique.
    expect(window.localStorage.getItem("admin_orders_search_query")).toBe('""');
    expect(window.localStorage.getItem("admin_orders_date_range")).toBe(
      JSON.stringify({ start: "", end: "" }),
    );
  });

  it("com N pedidos pagos após cancelado: aviso no plural", async () => {
    mockAnalyticsStats = statsFake({
      monthCount: 6,
      deliveredTotal: 3,
      paidOnCancelled: 2,
    });

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(hospedeiro.textContent).toContain(
      "2 pedidos receberam pagamento e estão cancelados",
    );
  });

  it("clique em 'Ver pedidos' não deixa a lupa da busca girando para sempre (achado 2, regressão)", async () => {
    mockAnalyticsStats = statsFake({
      monthCount: 6,
      deliveredTotal: 3,
      paidOnCancelled: 1,
    });
    // Busca com valor gravado de uma sessão anterior — é a zerada de fora
    // (`setSearchQuery("")`) que expõe o furo no `DebouncedSearchInput`.
    window.localStorage.setItem(
      "admin_orders_search_query",
      JSON.stringify("maria"),
    );

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Ver pedidos",
    );
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // O input de busca (`DebouncedSearchInput`) tem atraso de 300ms e a
    // tela recarrega a lista em ~320ms — esperar o suficiente para o
    // efeito assíncrono do componente rodar de verdade, em vez de afirmar
    // logo depois do clique, quando o ícone ainda pode não ter trocado.
    const campoBusca = () =>
      hospedeiro.querySelector<HTMLInputElement>("#orders-search");
    const lupaGirando = () => {
      const container = campoBusca()?.closest(".group");
      return container?.querySelector("svg.animate-spin") ?? null;
    };

    await esperarAte(() => lupaGirando() === null, { timeoutMs: 2000 });

    expect(campoBusca()).toBeTruthy();
    expect(lupaGirando()).toBeNull();
  });
});
