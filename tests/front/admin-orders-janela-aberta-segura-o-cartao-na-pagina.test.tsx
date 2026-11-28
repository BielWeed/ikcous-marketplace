// @vitest-environment jsdom
//
// A janela de ação de um cartão (Ações, Cancelar, Marcar como recebido,
// anular venda do balcão com motivo...) é estado do próprio cartão. Quando um
// pedido novo empurrava esse cartão para fora da página 1, ele desmontava e a
// janela sumia sem aviso, levando o texto digitado. O hook só segura o cartão
// na página se a tela contar quais cartões estão com a janela aberta: este
// teste prova a ponta da tela (cartão real -> tela -> opção do useOrders). A
// ponta do hook está em use-orders-realtime-insert-segura-cartao-com-janela-
// aberta.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const ID_DO_PEDIDO = "pedido-c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

const { opcoesDoHook } = vi.hoisted(() => ({
  opcoesDoHook: {
    atual: undefined as
      | { pedidosQueNaoSaemDaPagina?: () => ReadonlySet<string> }
      | undefined,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({
    paraPreparar: null,
    aguardandoPagamento: null,
    aCaminho: null,
    abertosComPagamentoAConferir: null,
    pedirRecarga: vi.fn(),
  }),
}));

const pedido: Order = {
  id: ID_DO_PEDIDO,
  userId: "cliente-1",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "pix",
  paymentStatus: "pago",
  status: "processing",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", async () => {
  const { ErroPedidoMudou } =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ErroPedidoMudou,
    useOrders: (
      _ativo: boolean,
      _admin: boolean,
      opcoes?: { pedidosQueNaoSaemDaPagina?: () => ReadonlySet<string> },
    ) => {
      opcoesDoHook.atual = opcoes;
      return {
        orders: [pedido],
        loadOrders: vi.fn(async () => ({ orders: [pedido], total: 1 })),
        updateOrderStatus: vi.fn(async () => {}),
        totalOrders: 1,
        isLoaded: true,
        loading: false,
      };
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorQueNaoObserva {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function seguros(): string[] {
  return [...(opcoesDoHook.atual?.pedidosQueNaoSaemDaPagina?.() ?? [])];
}

describe("Pedidos — cartão com a janela de ação aberta fica na página", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.stubGlobal("ResizeObserver", ObservadorQueNaoObserva);
    vi.stubGlobal("IntersectionObserver", ObservadorQueNaoObserva);
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
  });

  it("abrir as Ações do cartão o marca; fechar a janela o solta", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperar(20);
    });
    expect(seguros()).toEqual([]);

    const abrir = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Ações do pedido #3884BE"]',
    );
    expect(abrir).toBeTruthy();
    await act(async () => {
      abrir?.click();
    });
    expect(seguros()).toEqual([ID_DO_PEDIDO]);

    const fechar = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Fechar ações do pedido"]',
    );
    expect(fechar).toBeTruthy();
    await act(async () => {
      fechar?.click();
    });
    expect(seguros()).toEqual([]);
  });
});
