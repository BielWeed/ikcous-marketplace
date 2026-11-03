// @vitest-environment jsdom
//
// Filtro padrão "Em Aberto" + chip "Balcão" (ou filtro de pagamento): a lista
// vem vazia porque venda do balcão já nasce como "Entregue" e "Em Aberto" não
// mostra entregues. O aviso de lista vazia só culpava o canal/pagamento
// ("limpe o filtro de canal"), e limpar o canal não traz as vendas de volta.
// Agora o aviso diz que o "Em Aberto" também está ligado e sugere "Todos".
// O comportamento do chip NÃO muda (só o texto).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));

let mockOrders: Order[] = [];
let mockTotalOrders = 0;

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ...real,
    useOrders: () => ({
      orders: mockOrders,
      loadOrders: vi.fn(),
      buscarPedidosDoFiltroParaExportar: vi.fn().mockResolvedValue([]),
      updateOrderStatus: vi.fn(),
      totalOrders: mockTotalOrders,
      isLoaded: true,
      loading: false,
    }),
  };
});

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminOrdersView — lista vazia com 'Em Aberto' ligado junto de canal ou pagamento", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
  });

  async function montarVazio(filtros: Record<string, string>) {
    // `active={true}` liga a medição do total ABSOLUTO da loja (83): é ela que
    // separa "loja sem pedido nenhum" de "filtro que não casa com nada".
    vi.doMock("@/lib/supabase", () => ({
      supabase: {
        from: () => ({
          select: () => Promise.resolve({ count: 83, error: null }),
        }),
        rpc: vi.fn(),
        functions: { invoke: vi.fn() },
        channel: vi.fn(),
        removeChannel: vi.fn(),
      },
    }));
    for (const [chave, valor] of Object.entries(filtros)) {
      armazem.set(chave, JSON.stringify(valor));
    }
    mockOrders = [];
    mockTotalOrders = 0;
    vi.resetModules();
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  /** Só o bloco do aviso de lista vazia: "Em Aberto" também é o nome de um
   * chip de status da barra, então medir a tela inteira daria falso positivo. */
  function avisoDeListaVazia(titulo: string): string {
    const h3 = [...hospedeiro.querySelectorAll("h3")].find(
      (el) => el.textContent === titulo,
    );
    if (!h3?.parentElement)
      throw new Error(`aviso "${titulo}" não está na tela`);
    return h3.parentElement.textContent ?? "";
  }

  it("Em Aberto + Balcão: o aviso diz que 'Em Aberto' também está ligado, que a venda do balcão nasce Entregue e sugere 'Todos'", async () => {
    await montarVazio({
      admin_orders_filter_v2: "open",
      admin_orders_canal_filter: "presencial",
    });
    const texto = avisoDeListaVazia("Nenhum pedido nesse canal");
    expect(texto).toMatch(/Em Aberto/);
    expect(texto).toMatch(/nascem? como Entregue/);
    expect(texto).toMatch(/Todos/);
  });

  it("Em Aberto + filtro de pagamento: o aviso também cita o 'Em Aberto' e sugere 'Todos'", async () => {
    await montarVazio({
      admin_orders_filter_v2: "open",
      admin_orders_payment_filter: "pago",
    });
    const texto = avisoDeListaVazia(
      "Nenhum pedido com esse filtro de pagamento",
    );
    expect(texto).toMatch(/Em Aberto/);
    expect(texto).toMatch(/Todos/);
  });

  it("status 'Todos' + Balcão: o aviso de sempre, sem falar de 'Em Aberto'", async () => {
    await montarVazio({
      admin_orders_filter_v2: "all",
      admin_orders_canal_filter: "presencial",
    });
    const texto = avisoDeListaVazia("Nenhum pedido nesse canal");
    expect(texto).toContain(
      "Limpe o filtro de canal da venda para ver todos os pedidos.",
    );
    expect(texto).not.toMatch(/Em Aberto/);
  });
});
