// @vitest-environment jsdom
//
// Pedido do Gabriel (02/09, prova de rua no localhost): os avisos da tela de
// Pedidos — o bloco âmbar "N pedido(s) recebeu pagamento e está cancelado"
// e os dois baldes (mercadoria a voltar, estorno devido) — são GIGANTES e
// ficam permanentemente abertos, empurrando a lista real de pedidos para
// fora da tela. E o botão "Ver pedidos" mudava o filtro sem NENHUM feedback
// visível (sem rolar até a lista), o que o lojista lê como "botão morto".
//
// A CURA (comportamento novo, provado aqui):
//   1. A área toda nasce COLAPSADA numa pílula compacta (ícone de alerta +
//      título com a contagem + badges por tipo). O conteúdo detalhado só
//      aparece quando o lojista clica nela — e volta a colapsar no 2º clique.
//   2. O botão "Ver pedidos" continua gravando os filtros (comportamento já
//      provado em admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx)
//      e AGORA rola a página até a lista de pedidos — o clique tem resposta
//      visível.
//   3. Sem pendência nenhuma, nenhuma pílula existe (como os blocos antigos,
//      que só existiam com item).
//
// Segue o mesmo padrão de mocks de
// admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx (supabase,
// StoreContext, useAnalytics); `useOrders` aqui é mocado COM os campos dos
// baldes (`pedidosCancelados`/`fetchPedidosCancelados`) porque este teste
// exercita exatamente os baldes que o teste irmão deixa vazios.
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

// `let` porque cada teste controla o que a consulta de cancelados devolve.
let mockPedidosCancelados: Order[] = [];

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    totalOrders: mockTotalOrders,
    isLoaded: true,
    loading: false,
    pedidosCancelados: mockPedidosCancelados,
    fetchPedidosCancelados: vi.fn(async () => mockPedidosCancelados),
    pedidosCanceladosIncompleto: false,
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

function statsFake(paidOnCancelled?: number) {
  return {
    today: {
      revenue: 0,
      count: 0,
      pending: 0,
      revenueTrend: 0,
      countTrend: 0,
    },
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
    paidOnCancelled,
  };
}

/** Pedido cancelado com só os campos que esta tela lê (os baldes derivam de
 * `status`, `paymentStatus`, `cancelledAfterShipping`, `returnedToSellerAt`;
 * os cartões mostram `id`/`customer`/`total`). Objeto parcial com cast —
 * `Order` completo não é necessário para o que este teste exercita. */
function canceladoFake(campos: {
  id: string;
  paymentStatus?: Order["paymentStatus"];
  cancelledAfterShipping?: boolean;
  returnedToSellerAt?: string | null;
}): Order {
  return {
    id: campos.id,
    status: "cancelled",
    paymentStatus: campos.paymentStatus ?? null,
    cancelledAfterShipping: campos.cancelledAfterShipping ?? false,
    returnedToSellerAt: campos.returnedToSellerAt ?? null,
    customer: { name: "Gabriel" },
    total: 1,
  } as unknown as Order;
}

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

/** Encontra a pílula colapsável pelos `data-testid` — o conteúdo dela é o
 * que muda de tela para tela; o contrato é o botão com estado `aria-expanded`. */
const pílula = () =>
  hospedeiro.querySelector<HTMLButtonElement>(
    'button[data-testid="alertas-cancelados-alavanca"]',
  );

async function expandir() {
  expect(pílula()).toBeTruthy();
  await act(async () => {
    pílula()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

let hospedeiro: HTMLDivElement;
let raiz: Root;

describe("AdminOrdersView — alertas de cancelados colapsados numa pílula", () => {
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
    mockPedidosCancelados = [];
    mockAnalyticsStats = null;
  });

  it("com dinheiro preso, a área nasce COLAPSADA: pílula com a contagem, sem os blocos gigantes", async () => {
    mockAnalyticsStats = statsFake(2);

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    // A pílula existe e o TÍTULO carrega a contagem (mesma frase já provada
    // no teste irmão — singular/plural vêm de lá).
    expect(pílula()).toBeTruthy();
    expect(pílula()!.textContent).toContain(
      "2 pedidos receberam pagamento e estão cancelados",
    );
    // E o conteúdo detalhado NÃO está na tela: os textos longos dos blocos
    // antigos só existem com a pílula expandida.
    expect(hospedeiro.textContent).not.toContain(
      "O dinheiro entrou e o pedido está cancelado",
    );
    expect(hospedeiro.textContent).not.toContain(
      "esta tela não devolve dinheiro nenhum",
    );
    expect(pílula()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("clique na pílula expande os detalhes; segundo clique colapsa de novo", async () => {
    mockAnalyticsStats = statsFake(1);

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await expandir();

    // Expandida: os textos longos e o botão de destino voltam a existir —
    // o conteúdo é o mesmo dos blocos antigos (nenhuma palavra honesta se
    // perdeu, só o espaço que ela ocupava).
    expect(hospedeiro.textContent).toContain(
      "O dinheiro entrou e o pedido está cancelado",
    );
    expect(pílula()!.getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      pílula()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(hospedeiro.textContent).not.toContain(
      "O dinheiro entrou e o pedido está cancelado",
    );
    expect(pílula()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("sem pendência nenhuma, nenhuma pílula existe", async () => {
    mockAnalyticsStats = statsFake(0);
    mockPedidosCancelados = [];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(pílula()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("produto a voltar");
    expect(hospedeiro.textContent).not.toContain("estorno devido");
  });

  it("cancelado que nunca foi pago, com mercadoria fora: pílula fala de PRODUTO a voltar e não inventa estorno", async () => {
    // Mesmo cenário do achado da revisão de 26/08: pedido fechado "na
    // entrega" (paymentStatus NULL) cancelado depois do envio — o balde de
    // mercadoria aparece, o de dinheiro NÃO.
    mockAnalyticsStats = statsFake(0);
    mockPedidosCancelados = [
      canceladoFake({ id: "abc123", cancelledAfterShipping: true }),
    ];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(pílula()).toBeTruthy();
    expect(pílula()!.textContent).toContain("produto a voltar (1)");
    expect(pílula()!.textContent).not.toContain("estorno devido");
  });

  it("cancelado pago sem envio: pílula mostra o badge de ESTORNO devido", async () => {
    mockAnalyticsStats = statsFake(0);
    mockPedidosCancelados = [
      canceladoFake({ id: "def456", paymentStatus: "pago" }),
    ];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(pílula()).toBeTruthy();
    expect(pílula()!.textContent).toContain("estorno devido (1)");
  });

  it("'Ver pedidos' (dentro da pílula expandida) grava os filtros E rola até a lista", async () => {
    // O jsdom não implementa scrollIntoView; o stub é o próprio contrato do
    // teste: a pílula expandida chama o scroll na âncora da lista.
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView =
      scrollSpy as unknown as typeof Element.prototype.scrollIntoView;

    mockAnalyticsStats = statsFake(1);
    window.localStorage.setItem(
      "admin_orders_search_query",
      JSON.stringify("maria"),
    );

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await expandir();

    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Ver pedidos",
    );
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Comportamento de filtro já provado no teste irmão — reafirmado aqui
    // porque o clique agora mora dentro da pílula.
    expect(window.localStorage.getItem("admin_orders_filter_v2")).toBe(
      '"cancelled"',
    );
    expect(window.localStorage.getItem("admin_orders_search_query")).toBe('""');
    // E o novo contrato: a página rola até a lista — o clique tem resposta
    // visível (era o "botão que não funciona" do relato do Gabriel).
    await esperarAte(() => scrollSpy.mock.calls.length > 0);
    expect(scrollSpy).toHaveBeenCalled();
  });
});
