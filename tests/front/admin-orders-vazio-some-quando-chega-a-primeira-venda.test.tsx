// @vitest-environment jsdom
//
// Loja nova, tela de pedidos aberta no filtro padrão "Em aberto": a contagem
// absoluta de pedidos da loja era medida UMA vez (deu 0) e nunca mais. Depois
// da primeira venda (balcão nasce "Finalizado", fora do "Em aberto") a lista
// continua vazia, e a tela seguia dizendo "Seus pedidos vão aparecer aqui ·
// Quando chegar a primeira venda…" e escondia o botão "Limpar busca e
// filtros" — mentira para quem acabou de vender.
//
// O CONTRATO: chegou pedido pelo tempo real, a contagem é refeita; a lista
// vazia só diz "ainda não há pedidos" se a contagem NO MOMENTO for 0.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockOrders: any[] = [];
let totalAbsolutoNoBanco: number | null = 0;
let contagensFeitas = 0;
let aoChegarEventoDeTempoReal: ((payload: unknown) => void) | undefined;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      builder.then = (resolve: any, reject?: any) => {
        contagensFeitas += 1;
        return Promise.resolve({
          count: totalAbsolutoNoBanco,
          error: null,
        }).then(resolve, reject);
      };
      return builder;
    }),
    rpc: vi.fn(() =>
      Promise.resolve({ data: { total_count: 0 }, error: null }),
    ),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: (
    _ativo: boolean,
    _x: boolean,
    opcoes?: { onRealtimeEvent?: (payload: unknown) => void },
  ) => {
    aoChegarEventoDeTempoReal = opcoes?.onRealtimeEvent;
    return {
      orders: mockOrders,
      totalOrders: 0,
      isLoaded: true,
      loading: false,
      loadOrders: vi.fn(),
      updateOrderStatus: vi.fn(),
      pedidosCancelados: [],
      fetchPedidosCancelados: vi.fn(async () => []),
      pedidosCanceladosIncompleto: false,
    };
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminOrdersView — a primeira venda desfaz o 'ainda não há pedidos'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    mockOrders = [];
    totalAbsolutoNoBanco = 0;
    contagensFeitas = 0;
    aoChegarEventoDeTempoReal = undefined;
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
  });

  async function montarEEsperarAMedicao() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it("loja nova: antes da venda o convite aparece (sem regressão)", async () => {
    await montarEEsperarAMedicao();
    expect(hospedeiro.textContent).toContain("Quando chegar a primeira venda");
    expect(hospedeiro.textContent).not.toContain("Limpar busca e filtros");
  });

  it("chega um pedido finalizado (fora do 'Em aberto'): o convite some e o botão de limpar filtros aparece", async () => {
    await montarEEsperarAMedicao();
    expect(hospedeiro.textContent).toContain("Quando chegar a primeira venda");
    const antes = contagensFeitas;

    // A venda de balcão entra no banco como "Finalizado"; a lista do filtro
    // "Em aberto" segue vazia.
    totalAbsolutoNoBanco = 1;
    await act(async () => {
      aoChegarEventoDeTempoReal?.({
        eventType: "INSERT",
        new: { id: "pedido-balcao-1", status: "delivered" },
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(contagensFeitas).toBeGreaterThan(antes);
    expect(hospedeiro.textContent).not.toContain(
      "Quando chegar a primeira venda",
    );
    expect(hospedeiro.textContent).toContain("Limpar busca e filtros");
  });

  it("lista que passou a ter pedidos desmente o 0: quando esvazia de novo, mede de novo em vez de repetir o convite", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await montarEEsperarAMedicao();
    expect(hospedeiro.textContent).toContain("Quando chegar a primeira venda");

    // A lista ganha um pedido (sem evento de tempo real: recarga qualquer)...
    mockOrders = [
      {
        id: "pedido-lista-1",
        customer: { name: "Cliente Teste", whatsapp: "34999999999" },
        items: [],
        subtotal: 10,
        shipping: 0,
        discount: 0,
        total: 10,
        paymentMethod: "online",
        paymentStatus: "pago",
        status: "pending",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        cancelledAfterShipping: false,
      },
    ];
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(hospedeiro.textContent).not.toContain(
      "Quando chegar a primeira venda",
    );

    // ...e esvazia por causa do filtro, com 1 pedido na loja.
    mockOrders = [];
    totalAbsolutoNoBanco = 1;
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(hospedeiro.textContent).not.toContain(
      "Quando chegar a primeira venda",
    );
    expect(hospedeiro.textContent).toContain("Limpar busca e filtros");
  });

  it("se a nova contagem ainda for 0 (evento de outra tabela/ruído), o convite continua", async () => {
    await montarEEsperarAMedicao();
    totalAbsolutoNoBanco = 0;
    await act(async () => {
      aoChegarEventoDeTempoReal?.({
        eventType: "INSERT",
        new: { id: "pedido-1", status: "pending" },
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(hospedeiro.textContent).toContain("Quando chegar a primeira venda");
  });
});
