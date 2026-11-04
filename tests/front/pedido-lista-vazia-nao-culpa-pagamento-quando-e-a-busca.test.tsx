// @vitest-environment jsdom
//
// Achado 9 (caça autônoma R4) — com o filtro de pagamento (ou o de canal)
// ligado, o aviso de lista vazia culpava SEMPRE o pagamento/canal ("Nenhum
// pedido com esse status de pagamento. Limpe o filtro..."), mesmo quando a
// causa era a busca ou o período: a lojista limpava o filtro, a lista seguia
// vazia e ela ficava sem entender. Os textos específicos só valem quando busca
// e período estão vazios; senão vale o texto de recorte, que cita os dois.
//
// Casco: pedido-lista-vazia-explica-o-filtro-em-aberto.test.tsx.
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

describe("AdminOrdersView — lista vazia não culpa o pagamento/canal quando a causa é busca ou período", () => {
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

  async function montarVazio(filtros: Record<string, unknown>) {
    // A loja tem 83 pedidos: o vazio é de FILTRO, não de loja sem venda.
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

  const titulos = () =>
    [...hospedeiro.querySelectorAll("h3")].map((el) => el.textContent);

  it.each([
    ["busca", { admin_orders_search_query: "Fulana" }],
    [
      "período",
      { admin_orders_date_range: { start: "2026-10-01", end: "2026-10-31" } },
    ],
  ])(
    "pagamento 'Pago' + %s sem resultado: texto de recorte, não o de pagamento",
    async (_nome, extra) => {
      await montarVazio({
        admin_orders_filter_v2: "all",
        admin_orders_payment_filter: "pago",
        ...extra,
      });

      expect(titulos()).toContain("Nenhum pedido neste recorte");
      expect(titulos()).not.toContain(
        "Nenhum pedido com esse filtro de pagamento",
      );
      expect(hospedeiro.textContent).toContain(
        "Pode ser o filtro de status, a busca ou o período",
      );
    },
  );

  it.each([
    ["busca", { admin_orders_search_query: "Fulana" }],
    [
      "período",
      { admin_orders_date_range: { start: "2026-10-01", end: "2026-10-31" } },
    ],
  ])(
    "canal 'Balcão' + %s sem resultado: texto de recorte, não o de canal",
    async (_nome, extra) => {
      await montarVazio({
        admin_orders_filter_v2: "all",
        admin_orders_canal_filter: "presencial",
        ...extra,
      });

      expect(titulos()).toContain("Nenhum pedido neste recorte");
      expect(titulos()).not.toContain("Nenhum pedido nesse canal");
    },
  );

  it("CONTROLE: pagamento 'Pago' sozinho continua com o texto de pagamento", async () => {
    await montarVazio({
      admin_orders_filter_v2: "all",
      admin_orders_payment_filter: "pago",
    });

    expect(titulos()).toContain("Nenhum pedido com esse filtro de pagamento");
    expect(titulos()).not.toContain("Nenhum pedido neste recorte");
  });

  it("CONTROLE: canal 'Balcão' sozinho continua com o texto de canal", async () => {
    await montarVazio({
      admin_orders_filter_v2: "all",
      admin_orders_canal_filter: "presencial",
    });

    expect(titulos()).toContain("Nenhum pedido nesse canal");
    expect(titulos()).not.toContain("Nenhum pedido neste recorte");
  });
});
