// @vitest-environment jsdom
//
// Laudo 0109 (A-7) — na ficha do pedido, o botão de WhatsApp era renderizado
// incondicionalmente e montava `wa.me/` com o que quer que estivesse salvo:
// sem número ou com número sem DDD ("99999-9999", 9 dígitos) a janela que
// abria era uma conversa inválida. A decisão agora é do util
// `linkWhatsappDoCliente`: `null` = SEM botão.
//
// Montagem pelo AdminOrdersView com selectedOrderId — mesmo casco de
// admin-orders-status-erro-cru-nao-duplica-toast.test.tsx.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    totalOrders: mockOrders.length,
    isLoaded: true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

// Laudo 0109 (onda 2, A-3): a AdminOrdersView passou a consumir useStore
// (nome da loja no recibo) — o teste monta a view e precisa do provedor.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function pedidoComWhatsapp(whatsapp: string): Order {
  return {
    id: "pedido-whatsapp-ficha",
    customer: {
      name: "Cliente Teste",
      whatsapp,
      address: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
      cep: "38500-000",
    },
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
    status: "processing",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
  };
}

let mockOrders: Order[] = [];

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
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

describe("OrderDetail — botão de WhatsApp sem destinatário não renderiza (laudo 0109, A-7)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    mockOrders = [];
  });

  async function montarFicha() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={mockOrders[0]!.id}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function botaoWhatsapp() {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Conversar no WhatsApp",
    );
  }

  it("sem WhatsApp salvo: o botão NÃO renderiza", async () => {
    mockOrders = [pedidoComWhatsapp("")];
    await montarFicha();
    expect(botaoWhatsapp()).toBeUndefined();
  });

  it("9 dígitos ('99999-9999', sem DDD): o botão NÃO renderiza", async () => {
    mockOrders = [pedidoComWhatsapp("99999-9999")];
    await montarFicha();
    expect(botaoWhatsapp()).toBeUndefined();
  });

  it("controle — 11 dígitos (DDD + 9): o botão continua aí", async () => {
    mockOrders = [pedidoComWhatsapp("34999999999")];
    await montarFicha();
    expect(botaoWhatsapp()).toBeTruthy();
  });
});
