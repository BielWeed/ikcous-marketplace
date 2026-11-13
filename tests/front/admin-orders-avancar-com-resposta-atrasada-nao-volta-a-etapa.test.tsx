// @vitest-environment jsdom
//
// A lojista toca em "Avançar" (Novo Pedido -> Em Separação) e, antes de a
// resposta chegar, o outro aparelho avança o MESMO pedido para "Em Trânsito".
// A ficha já mostra "Em Trânsito" (versão mais nova); quando a resposta do
// primeiro toque chegava, ela era aplicada por cima e a ficha voltava para
// "Em Separação", com o banco dizendo o contrário.
//
// Regra provada aqui: o resultado local só é aplicado se a ficha ainda está na
// etapa de que o toque partiu. Se ela já mudou (eco do próprio toque ou versão
// mais nova de outro aparelho), vale o que a ficha já tem.
import type { Order } from "@/types";
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
  id: "pedido-avancar-atrasado",
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

describe("AdminOrdersView — Avançar com resposta atrasada", () => {
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
  /** Toca em Avançar com a gravação segurada; `durante` roda enquanto ela está no ar. */
  async function avancar(durante: () => Promise<void>) {
    let concluir!: () => void;
    updateOrderStatus.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          concluir = resolve;
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
      concluir();
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

  it("o outro aparelho avançou mais: a resposta antiga não devolve a ficha para 'Em Separação'", async () => {
    await avancar(async () => {
      await chegaDoOutroAparelho("shipping");
    });
    // Já em Trânsito, o próximo passo é Finalizar (e não Em Trânsito).
    expect(proximaEtapa()).toContain("Finalizado");
  });

  it("borda: o outro aparelho cancelou no meio, a ficha continua cancelada", async () => {
    await avancar(async () => {
      await chegaDoOutroAparelho("cancelled");
    });
    expect(botaoAvancar()).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Este pedido foi cancelado e não pode prosseguir.",
    );
  });

  it("controle: sem nada no meio, a ficha mostra a etapa nova ao terminar", async () => {
    await avancar(async () => {});
    expect(proximaEtapa()).toContain("Em Trânsito");
  });
});
