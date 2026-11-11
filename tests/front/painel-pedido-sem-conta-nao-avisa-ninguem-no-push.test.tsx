// @vitest-environment jsdom
//
// Pedido de convidado ou de balcão (sem conta) não tem para quem mandar push:
// o canal dele é o WhatsApp. A guarda `if (!alvo.userId) return;` em
// `handleStatusChange` (AdminOrdersView) é a ÚNICA coisa que impede o aviso
// "Seu pedido #X agora está: ..." de sair com `targetUserId` ausente — e a edge
// `send-push` trata a ausência como "avisar todos", espalhando o status do
// pedido de UMA pessoa por todos os aparelhos inscritos da loja. A edge não
// recusa `order_status` sem alvo, então o painel é a única defesa; sem esta
// guarda nenhum teste vizinho percebia (eles só usam pedido COM conta).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const pedidoBase: Order = {
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

describe("Painel — pedido sem conta não dispara o aviso de status", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function avancarOPedido(pedido: Order) {
    mockOrders = [pedido];
    const { toast } = await import("sonner");
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
    return {
      envios: invoke.mock.calls.filter(([nome]) => nome === "send-push"),
      toast,
    };
  }

  function semNenhumAvisoDeFalha(toast: {
    warning: unknown;
    error: unknown;
  }) {
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  }

  it("pedido sem conta (userId ausente): nenhum push sai e nenhum aviso de falha aparece", async () => {
    const { envios, toast } = await avancarOPedido({
      ...pedidoBase,
      userId: undefined,
    });
    expect(envios).toHaveLength(0);
    semNenhumAvisoDeFalha(toast);
  });

  it("pedido sem conta (userId null, como vem do banco): nenhum push sai e nenhum aviso de falha aparece", async () => {
    const { envios, toast } = await avancarOPedido({
      ...pedidoBase,
      userId: null as unknown as undefined,
    });
    expect(envios).toHaveLength(0);
    semNenhumAvisoDeFalha(toast);
  });

  it("controle: pedido COM conta avança e o push sai UMA vez, só para essa conta", async () => {
    const { envios, toast } = await avancarOPedido(pedidoBase);
    expect(envios).toHaveLength(1);
    expect(envios[0]?.[1].body.targetUserId).toBe("cliente-1");
    semNenhumAvisoDeFalha(toast);
  });
});
