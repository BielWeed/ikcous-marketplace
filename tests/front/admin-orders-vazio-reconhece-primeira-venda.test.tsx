// @vitest-environment jsdom
//
// Relato do Gabriel (02/09, foto): loja SEM NENHUM pedido exibia "Nenhum
// pedido corresponde ao que está sendo mostrado agora — pode ser o filtro
// de status, a busca ou o período..." — orientação de FILTRO para quem
// sequer tem a primeira venda. A confusão nasce porque o filtro padrão da
// tela é "Em Aberto": lista vazia em loja vazia e lista vazia em loja cheia
// de pedidos antigos são o MESMO zero para o front.
//
// O CONTRATO: quando a lista aparece vazia, a view mede o COUNT absoluto
// (sem filtro nenhum, head count):
//   - 0  → "Ainda não tem nenhum pedido" + convite da primeira venda;
//   - >0 → as mensagens de filtro/busca de sempre (listas de verdade).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockOrders: any[] = [];
let mockTotalOrders = 0;

// Contagem ABSOLUTA de pedidos na loja — o que o novo count sem filtro
// devolve. `null` simula erro (a view deve manter as mensagens de sempre).
let totalAbsolutoNoBanco: number | null = 0;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      builder.then = (resolve: any, reject?: any) =>
        Promise.resolve({
          count: totalAbsolutoNoBanco,
          error: totalAbsolutoNoBanco === null ? { message: "x" } : null,
        }).then(resolve, reject);
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
  useOrders: () => ({
    orders: mockOrders,
    totalOrders: mockTotalOrders,
    isLoaded: true,
    loading: false,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    pedidosCancelados: [],
    fetchPedidosCancelados: vi.fn(async () => []),
    pedidosCanceladosIncompleto: false,
  }),
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

describe("AdminOrdersView — loja sem pedido nenhum vs filtro vazio", () => {
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
    totalAbsolutoNoBanco = 0;
  });

  it("loja sem venda nenhuma: 'Ainda não tem nenhum pedido', não orientação de filtro", async () => {
    mockOrders = [];
    mockTotalOrders = 0;
    totalAbsolutoNoBanco = 0;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    // O count absoluto é assíncrono: esperar a rodada de medição.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(hospedeiro.textContent).toContain("Ainda não tem nenhum pedido");
    expect(hospedeiro.textContent).toContain(
      "Quando a primeira venda acontecer",
    );
    // A orientação de filtro não tem o que ensinar numa loja vazia.
    expect(hospedeiro.textContent).not.toContain("Pode ser o filtro de status");
  });

  it("loja COM pedidos e lista vazia por filtro: mantém a orientação de filtro de sempre", async () => {
    mockOrders = [];
    mockTotalOrders = 0;
    totalAbsolutoNoBanco = 83;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(hospedeiro.textContent).toContain(
      "Nenhum pedido corresponde ao que está sendo mostrado agora",
    );
    expect(hospedeiro.textContent).not.toContain("Ainda não tem nenhum pedido");
  });
});
