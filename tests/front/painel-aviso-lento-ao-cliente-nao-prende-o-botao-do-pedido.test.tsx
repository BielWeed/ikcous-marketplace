// @vitest-environment jsdom
//
// Painel: depois de gravar o novo status, `handleStatusChange` esperava o
// envio do aviso (push) ao cliente SEM limite de tempo — e o botão do pedido
// ficava em "Processando..." (com Cancelar/Marcar como recebido desligados)
// até o aviso terminar, dezenas de segundos com sinal ruim. O status já está
// gravado e o aviso é secundário: o botão é liberado assim que o status é
// gravado, e o aviso segue por conta própria (mesmos avisos amarelos).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const ID_DO_PEDIDO = "c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

const { invoke, getSession, updateOrderStatus } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSession: vi.fn(),
  updateOrderStatus: vi.fn(),
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
      updateOrderStatus,
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

describe("Painel — aviso lento ao cliente não prende o botão do pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrders = [pedido];
    updateOrderStatus.mockResolvedValue(undefined);
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

  async function abrirEClicarEmAvancar() {
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
  }

  it("aviso que nunca responde: o status foi gravado e o botão sai de 'Processando...'", async () => {
    invoke.mockImplementation(() => new Promise(() => {}));

    await abrirEClicarEmAvancar();

    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    // O aviso foi disparado (o efeito continua existindo)...
    expect(invoke.mock.calls.some(([nome]) => nome === "send-push")).toBe(true);
    // ...mas não segura mais a tela.
    expect(hospedeiro.textContent).not.toContain("Processando");
  });

  it("o aviso só sai DEPOIS de o status ser gravado (mesma ordem de antes)", async () => {
    const ordem: string[] = [];
    updateOrderStatus.mockImplementation(async () => {
      ordem.push("status");
    });
    invoke.mockImplementation(async () => {
      ordem.push("aviso");
      return { data: { enviados: 1 }, error: null };
    });

    await abrirEClicarEmAvancar();

    expect(ordem).toEqual(["status", "aviso"]);
  });

  it("aviso lento que depois falha continua dando o aviso amarelo 'o push falhou'", async () => {
    invoke.mockImplementation(async () => {
      await esperar(30);
      throw new Error("sem rede");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { toast } = await import("sonner");

    await abrirEClicarEmAvancar();
    expect(hospedeiro.textContent).not.toContain("Processando");

    await act(async () => {
      await esperar(80);
    });
    expect(toast.warning).toHaveBeenCalledWith(
      "Status atualizado, mas o push falhou",
      expect.objectContaining({
        description: "O cliente não foi notificado da mudança.",
      }),
    );
  });
});
