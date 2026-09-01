// @vitest-environment jsdom
//
// Laudo 0109 (A-7, ressalva da revisão adversária da onda 1) — na LISTA de
// pedidos do painel o botão de WhatsApp dos cards renderizava SEMPRE, mesmo
// sem número válido do cliente: o toque não fazia nada (handleWhatsApp saía
// cedo) — botão mudo com cara de ação. A ficha do pedido já esconde o botão
// sem link (`linkWhatsappDoCliente` devolve null); a lista agora usa a MESMA
// regra. Este teste prova o card do modo detailed: sem número → sem botão;
// com 11 dígitos → botão presente.
//
// Mesmo casco de mocks de admin-orders-filtro-que-filtra.test.tsx.
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

let mockOrders: Order[] = [];

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

function pedidoFake(whatsapp: string | null): Order {
  return {
    id: `pedido-${whatsapp ?? "sem-numero"}`,
    // No banco o whatsapp do cliente pode vir ausente — o front lê
    // `order.customer?.whatsapp || ""`. O tipo do app declara string, então
    // o caso null entra por cast (dado real, não tipo real).
    customer: { name: "Cliente Teste", whatsapp } as Order["customer"],
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
  };
}

function botoesWhatsapp(hospedeiro: HTMLElement) {
  // O botão do card é o único `button` com o svg do MessageCircle (lucide) —
  // o chevron ao lado é `div`/`svg` solto, não botão.
  return hospedeiro.querySelectorAll("button svg.lucide-message-circle");
}

describe("AdminOrdersView — card da lista sem destinatário não renderiza botão de WhatsApp (laudo 0109, A-7)", () => {
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
    vi.resetModules();
    mockOrders = [];
  });

  it("cliente SEM número válido: o card não tem botão de WhatsApp", async () => {
    mockOrders = [pedidoFake(null), pedidoFake("999")];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(botoesWhatsapp(hospedeiro).length).toBe(0);
  });

  it("cliente COM número válido (11 dígitos): o botão está no card", async () => {
    mockOrders = [pedidoFake("34999999999")];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    expect(botoesWhatsapp(hospedeiro).length).toBe(1);
  });
});
