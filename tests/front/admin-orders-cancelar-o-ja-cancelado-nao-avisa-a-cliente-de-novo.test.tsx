// @vitest-environment jsdom
//
// Lote 528: a lojista cancela pela ficha um pedido online que JÁ ESTAVA
// cancelado (outro aparelho, a própria cliente). A edge responde `cancelado`
// com `jaEstava` e nada muda no banco agora; quem cancelou antes já deu o
// aviso dele. Antes a ficha mandava de novo "Seu pedido agora está:
// Cancelado" à cliente, carimbado com o relógio do aparelho. Agora
// `updateOrderStatus` diz `jaEstava` e a ficha não manda o push. O controle
// prova que o cancelamento de verdade continua avisando, com a hora do banco.
//
// Harness de admin-orders-cancelar-pela-edge.test.tsx (o módulo
// `@/hooks/useOrders` real, só `useOrders` trocado), com o pedido tendo conta
// (sem conta a ficha nunca manda push) e o aviso trocado por um espião.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  desligarDialogoDeConfirmacao,
  ligarDialogoDeConfirmacao,
} from "./duble-dialogo-de-confirmacao";

const updateOrderStatus = vi.fn();
const avisarOClienteDoStatus = vi.fn();

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
      updateOrderStatus,
      totalOrders: mockOrders.length,
      isLoaded: true,
      loading: false,
    }),
  };
});

vi.mock("@/lib/aviso-de-status-ao-cliente", async () => {
  const real = await vi.importActual<
    typeof import("@/lib/aviso-de-status-ao-cliente")
  >("@/lib/aviso-de-status-ao-cliente");
  return {
    ...real,
    avisarOClienteDoStatus: (...args: unknown[]) =>
      avisarOClienteDoStatus(...args),
  };
});

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
  clearAnalyticsCache: () => {},
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const pedidoOnline: Order = {
  id: "pedido-online-com-conta",
  userId: "cliente-com-conta",
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
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "online",
  paymentStatus: "aguardando",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

let mockOrders: Order[] = [pedidoOnline];

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminOrdersView — cancelar o que já estava cancelado não avisa a cliente de novo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateOrderStatus.mockReset();
    avisarOClienteDoStatus.mockReset();
    avisarOClienteDoStatus.mockResolvedValue(undefined);
    mockOrders = [pedidoOnline];
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
    vi.stubGlobal("ResizeObserver", ObservadorStub);
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    ligarDialogoDeConfirmacao();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    desligarDialogoDeConfirmacao();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarComPedidoSelecionado() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={pedidoOnline.id}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function botaoCancelarDaFicha() {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Cancelar pedido",
    );
  }

  async function clicarCancelar() {
    const botao = botaoCancelarDaFicha();
    expect(botao).toBeTruthy();
    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("a edge diz que já estava cancelado: a ficha vira cancelada e NENHUM push sai para a cliente", async () => {
    updateOrderStatus.mockResolvedValue({
      gravadoNoBancoEm: null,
      jaEstava: true,
    });
    await renderizarComPedidoSelecionado();

    await clicarCancelar();

    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(botaoCancelarDaFicha()).toBeFalsy();
    expect(avisarOClienteDoStatus).not.toHaveBeenCalled();
  });

  it("controle: cancelamento de verdade avisa a cliente, com a hora que o banco gravou", async () => {
    updateOrderStatus.mockResolvedValue({
      gravadoNoBancoEm: "2026-11-27T12:34:56Z",
    });
    await renderizarComPedidoSelecionado();

    await clicarCancelar();

    expect(avisarOClienteDoStatus).toHaveBeenCalledTimes(1);
    expect(avisarOClienteDoStatus).toHaveBeenCalledWith(
      pedidoOnline.id,
      "cancelled",
      expect.objectContaining({ userId: "cliente-com-conta" }),
      "2026-11-27T12:34:56Z",
    );
  });
});
