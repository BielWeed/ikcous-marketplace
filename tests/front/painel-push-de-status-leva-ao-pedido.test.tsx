// @vitest-environment jsdom
//
// Defeito da cliente (14/10/2026): o aviso "status do pedido" que o painel
// manda ao avançar um pedido abria a VITRINE em vez do pedido. O painel
// enviava `data: { orderId }` sem `url`; a edge `send-push` grava
// `url: url || "/"` e o service worker abre só `data.url` ao tocar na
// notificação (src/sw/sw.ts, `notificationclick`).
//
// Conserto só no painel: o disparo agora leva `url: "/order-details?id=<id>"`,
// o formato que o app usa na própria barra de endereço e que `navegarPorUrl`
// (NotificationsView) entende. Casco: AdminOrdersView montada de verdade, só o
// `invoke` da edge é dublê — o que se mede é o corpo que SAI.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { urlDoPedidoNoPush } from "@/lib/url-do-pedido-no-push";
import type { Order } from "@/types";

const ID_DO_PEDIDO = "c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

const { invoke, getSession } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke },
    auth: { getSession },
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

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

let mockOrders: Order[] = [];

vi.mock("@/hooks/useOrders", async () => {
  const { ErroPedidoMudou } =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ErroPedidoMudou,
    useOrders: () => ({
      orders: mockOrders,
      loadOrders: vi.fn(),
      updateOrderStatus: vi.fn(async () => {}),
      totalOrders: mockOrders.length,
      isLoaded: true,
      loading: false,
    }),
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

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("urlDoPedidoNoPush — o endereço que o aviso abre", () => {
  it("é o formato que o app usa na barra de endereço", () => {
    expect(urlDoPedidoNoPush(ID_DO_PEDIDO)).toBe(
      `/order-details?id=${ID_DO_PEDIDO}`,
    );
  });

  it("um id com caractere especial não quebra a consulta", () => {
    expect(urlDoPedidoNoPush("a&b=c")).toBe("/order-details?id=a%26b%3Dc");
  });
});

describe("Painel — o push de 'status atualizado' abre o pedido, não a vitrine", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrders = [pedido];
    getSession.mockResolvedValue({ data: { session: null } });
    invoke.mockResolvedValue({ data: { enviados: 1 }, error: null });
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
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
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

  it("avançar o pedido manda o push com a url do detalhe do pedido", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={ID_DO_PEDIDO}
        />,
      );
    });
    await act(async () => {
      await esperar(20);
    });

    const avancar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Avançar"),
    );
    expect(avancar).toBeTruthy();
    await act(async () => {
      avancar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(20);
    });

    const chamada = invoke.mock.calls.find(([nome]) => nome === "send-push");
    expect(chamada).toBeTruthy();
    const corpo = chamada?.[1].body;
    expect(corpo.url).toBe(`/order-details?id=${ID_DO_PEDIDO}`);
    // O resto do aviso segue como estava.
    expect(corpo.targetUserId).toBe("cliente-1");
    expect(corpo.data).toEqual({ orderId: ID_DO_PEDIDO, type: "order_status" });
  });
});
