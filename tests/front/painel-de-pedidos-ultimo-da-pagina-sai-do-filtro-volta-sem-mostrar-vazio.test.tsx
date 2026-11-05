// @vitest-environment jsdom
//
// Filtro "Em Aberto" com 13 pedidos (12 por página): a lojista está na
// página 2, que tem só 1 pedido, e finaliza (ou cancela) esse pedido. O evento
// do tempo real tira o pedido do filtro NA HORA, mas o total (13) só encolhe
// quando a releitura volta — então a página 2 ficava vazia e a tela dizia
// "Nenhum pedido neste recorte" + "Limpar busca e filtros" pelo tempo da
// recarga (mais de 1 s, e bem mais com rede lenta), e a lojista achava que os
// pedidos tinham sumido. Agora a tela volta NA HORA para a página anterior e
// mostra o carregando, nunca o texto de vazio.
//
// Mesmo padrão de mock de painel-de-pedidos-volta-da-pagina-que-nao-existe-mais.test.tsx
// (`useOrders` mocado para o teste controlar `orders`, `totalOrders` e o carregando).
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
let mockIsLoaded = true;
let mockErro: string | null = null;
let mockLoadOrders: ReturnType<typeof vi.fn>;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: mockLoadOrders,
    updateOrderStatus: vi.fn(),
    totalOrders: mockTotalOrders,
    isLoaded: mockIsLoaded,
    loading: !mockIsLoaded,
    erroDaListagem: mockErro,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
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

function pedidoFake(id: string, paymentStatus: "pago" | "aguardando"): Order {
  return {
    id,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
  };
}

const TEXTO_DE_VAZIO = "Nenhum pedido neste recorte";

describe("AdminOrdersView — o último pedido da última página sai do filtro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  async function montar() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
  }
  /** Re-renderiza com o que o hook devolve agora (o evento do tempo real). */
  async function renderizarDeNovo() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
  }
  const paginaSalva = () => armazem.get("admin_orders_current_page");

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

    mockIsLoaded = true;
    mockErro = null;
    mockOrders = [];
    mockTotalOrders = 0;
    // O hook de verdade liga o carregando no mesmo instante em que a consulta
    // começa; o dublê faz o mesmo para a tela poder mostrar o esqueleto.
    mockLoadOrders = vi.fn(() => {
      mockIsLoaded = false;
    });
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
    vi.resetModules();
  });

  it("página 2 com 1 pedido: ele sai do filtro -> volta para a página 1 sem mostrar 'Nenhum pedido neste recorte'", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(1));
    mockOrders = [pedidoFake("ped-13", "aguardando")];
    mockTotalOrders = 13; // 2 páginas de 12: a página 2 tem só o 13º
    await montar();
    expect(hospedeiro.textContent).not.toContain(TEXTO_DE_VAZIO);
    mockLoadOrders.mockClear();

    // Evento do tempo real: o pedido deixa o filtro; o total ainda é 13.
    mockOrders = [];
    await renderizarDeNovo();

    expect(hospedeiro.textContent).not.toContain(TEXTO_DE_VAZIO);
    expect(paginaSalva()).toBe("0");
    const consultas = mockLoadOrders.mock.calls.map((chamada) => chamada[0]);
    expect(consultas).toContain(0);
  });

  it("volta UMA página por vez e para onde os pedidos existem (sem laço até a página 0)", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(2));
    mockOrders = [pedidoFake("ped-25", "aguardando")];
    mockTotalOrders = 25; // 3 páginas; a 3ª tem só 1
    await montar();

    mockOrders = [];
    await renderizarDeNovo();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(paginaSalva()).toBe("1");
  });

  it("controle: página vazia que NUNCA teve pedido nesta página não volta sozinha", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(1));
    mockOrders = [];
    mockTotalOrders = 30;
    await montar();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(paginaSalva()).toBe("1");
  });

  it("controle: filtro de pagamento que esvazia a página (a lista tem pedidos) não faz voltar de página", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(1));
    armazem.set("admin_orders_payment_filter", JSON.stringify("estornado"));
    mockOrders = [pedidoFake("ped-13", "pago")];
    mockTotalOrders = 64;
    await montar();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(paginaSalva()).toBe("1");
  });

  it("controle: com erro de carregamento a página não anda", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(1));
    mockOrders = [pedidoFake("ped-13", "aguardando")];
    mockTotalOrders = 13;
    await montar();

    mockOrders = [];
    mockErro = "Não conseguimos carregar os pedidos agora.";
    await renderizarDeNovo();

    expect(paginaSalva()).toBe("1");
  });
});
