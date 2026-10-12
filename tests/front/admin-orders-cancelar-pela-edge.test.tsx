// @vitest-environment jsdom
//
// S1 (dinheiro, 04/10/2026, migration 20261198000000): a lojista cancela pela
// ficha do painel (AdminOrdersView → OrderDetail → "Cancelar pedido") um
// pedido de pagamento ONLINE. O cancelamento passa pela edge
// `criar-pagamento`, que anula a cobrança no Mercado Pago antes; quando ela
// NÃO cancela, `useOrders` já mostrou o ÚNICO aviso e lança
// `ErroCancelamentoNaoConcluido`. A ficha tem de:
//   - nunca virar "cancelado" sem a resposta `cancelado`;
//   - quando a edge relê o pedido (`err.pedido`, ex.: pago no meio), mostrar
//     o estado de verdade na ficha;
//   - não acender um SEGUNDO toast por cima do aviso do hook (mesma régua de
//     admin-orders-status-erro-cru-nao-duplica-toast.test.tsx).
// Harness copiado de admin-orders-status-erro-cru-nao-duplica-toast.test.tsx,
// com o módulo `@/hooks/useOrders` REAL (só `useOrders` trocado) — a tela
// usa a classe de erro de verdade (`instanceof`).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateOrderStatus = vi.fn();

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
  id: "pedido-online-aguardando",
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

describe("AdminOrdersView — cancelar pedido online pela edge (S1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateOrderStatus.mockReset();
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

  /** Quantos elementos mostram exatamente este rótulo (o selo de pagamento). */
  function contarRotulo(rotulo: string): number {
    return Array.from(hospedeiro.querySelectorAll("*")).filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === rotulo,
    ).length;
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

  it("edge responde ja_pago com o pedido relido: a ficha passa a mostrar PAGO, NÃO vira cancelada, e nenhum toast extra da tela", async () => {
    const { ErroCancelamentoNaoConcluido } = await import("@/hooks/useOrders");
    updateOrderStatus.mockImplementation(async () => {
      // Dublê do hook: o aviso único já saiu lá dentro (toast.warning).
      toast.warning("frase da edge: já pago");
      throw new ErroCancelamentoNaoConcluido({
        desfecho: "ja_pago",
        mensagem: "frase da edge: já pago",
        pedido: { status: "pending", paymentStatus: "pago" },
      });
    });
    await renderizarComPedidoSelecionado();
    const pagosAntes = contarRotulo("Pago");

    await clicarCancelar();

    expect(updateOrderStatus).toHaveBeenCalledWith(
      pedidoOnline.id,
      "cancelled",
      undefined,
      false,
      "pending",
    );
    expect(contarRotulo("Pago")).toBeGreaterThan(pagosAntes);
    // Não cancelou: o botão de cancelar da ficha continua lá.
    expect(botaoCancelarDaFicha()).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("edge responde em_analise SEM pedido relido: a ficha fica como estava (nem pago, nem cancelado)", async () => {
    const { ErroCancelamentoNaoConcluido } = await import("@/hooks/useOrders");
    updateOrderStatus.mockRejectedValue(
      new ErroCancelamentoNaoConcluido({
        desfecho: "em_analise",
        mensagem: "frase da edge: em análise",
      }),
    );
    await renderizarComPedidoSelecionado();
    const pagosAntes = contarRotulo("Pago");

    await clicarCancelar();

    expect(contarRotulo("Pago")).toBe(pagosAntes);
    expect(botaoCancelarDaFicha()).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("controle: edge cancelou (updateOrderStatus resolve) — a ficha vira cancelada e o botão de cancelar some", async () => {
    updateOrderStatus.mockResolvedValue(undefined);
    await renderizarComPedidoSelecionado();

    await clicarCancelar();

    expect(botaoCancelarDaFicha()).toBeFalsy();
  });
});
