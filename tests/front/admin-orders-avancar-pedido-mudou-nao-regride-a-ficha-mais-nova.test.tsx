// @vitest-environment jsdom
//
// A lojista toca em "Avançar" (Novo Pedido -> Em Separação) e a releitura do
// hook acha o pedido em "Em Trânsito" (outro aparelho já avançou): o hook
// recusa com `ErroPedidoMudou("shipping")` e a view corrige a ficha para esse
// status. Só que, enquanto a releitura estava no ar, o outro aparelho
// FINALIZOU o pedido e o evento ao vivo já levou a ficha a "Finalizado". A
// correção (retrato mais velho que o evento) fazia a ficha regredir a "Em
// Trânsito" — com o banco certo; só a tela mentia até a próxima leitura.
//
// Regra provada aqui: o status verdadeiro do erro só é aplicado se a ficha
// ainda está na etapa de que o toque partiu (mesma regra do caminho de
// sucesso, ver admin-orders-avancar-com-resposta-atrasada-nao-volta-a-etapa).
import type { Order, OrderStatus } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateOrderStatus = vi.fn<(...args: unknown[]) => Promise<void>>();

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ErroPedidoMudou: real.ErroPedidoMudou,
    mensagemAmigavelErroAtualizacaoStatus:
      real.mensagemAmigavelErroAtualizacaoStatus,
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
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
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
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const pedidoBase: Order = {
  id: "pedido-mudou-regride",
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
  paymentMethod: "pix",
  paymentStatus: "pago",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};
let mockOrders: Order[] = [pedidoBase];

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

describe("AdminOrdersView — 'Este pedido mudou' não regride a ficha que já tem versão mais nova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateOrderStatus.mockReset();
    mockOrders = [pedidoBase];
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

  async function renderizar() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={pedidoBase.id}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }
  const botaoAvancar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Avançar"),
    );
  /** O botão da ficha diz para onde o pedido vai a partir da etapa atual. */
  const proximaEtapa = () => botaoAvancar()?.textContent ?? "";

  /**
   * Toca em Avançar com a releitura segurada; `durante` roda enquanto ela está
   * no ar; depois ela termina dizendo que o servidor tinha `statusRelido`.
   */
  async function avancar(
    statusRelido: OrderStatus,
    durante: () => Promise<void>,
  ) {
    const { ErroPedidoMudou } = await import("@/hooks/useOrders");
    let recusar!: () => void;
    updateOrderStatus.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          recusar = () => reject(new ErroPedidoMudou(statusRelido));
        }),
    );
    await renderizar();
    expect(proximaEtapa()).toContain("Em Separação");
    await act(async () => {
      botaoAvancar()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    await durante();
    await act(async () => {
      recusar();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
  /** O que o outro aparelho gravou chega à tela (evento ao vivo na lista). */
  async function chegaDoOutroAparelho(status: Order["status"]) {
    mockOrders = [
      { ...pedidoBase, status, updatedAt: new Date(60_000).toISOString() },
    ];
    await renderizar();
  }

  it("controle: sem nada no meio, a ficha passa para o status que a releitura achou", async () => {
    await avancar("shipping", async () => {});
    // Em Trânsito: o próximo passo é Finalizar.
    expect(proximaEtapa()).toContain("Finalizado");
  });

  it("o outro aparelho avançou mais durante a releitura: a ficha fica na etapa mais nova, sem voltar à que a releitura achou", async () => {
    // A releitura achou "Em Separação"; antes de ela voltar, o outro aparelho
    // já levou o pedido a "Em Trânsito" e o evento ao vivo chegou à ficha.
    await avancar("processing", async () => {
      await chegaDoOutroAparelho("shipping");
    });
    // Em Trânsito: o próximo passo é Finalizar (e não Em Trânsito).
    expect(proximaEtapa()).toContain("Finalizado");
  });

  it("borda: o outro aparelho cancelou durante a releitura: a ficha continua cancelada", async () => {
    await avancar("shipping", async () => {
      await chegaDoOutroAparelho("cancelled");
    });
    expect(botaoAvancar()).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Este pedido foi cancelado e não pode prosseguir.",
    );
  });
});
