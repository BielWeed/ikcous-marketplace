// @vitest-environment jsdom
//
// RETIRADA NA LOJA (14/10/2026), o que a cliente RECEBE: o push, a mensagem de
// WhatsApp e o aviso da lojista diziam "Em Trânsito" mesmo numa retirada.
// Agora dizem "Pronto para retirar". Pedido de entrega fica igual (controle).
// Mesmo casco de painel-avisa-o-cliente-com-o-numero-que-ele-ve.test.tsx.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const ID_DO_PEDIDO = "pedido-c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

const { invoke, getSession, eventoRealtime } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSession: vi.fn(),
  // O callback que a tela registra no `useOrders` para os eventos realtime.
  eventoRealtime: {
    atual: undefined as ((payload: unknown) => void) | undefined,
  },
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
    useOrders: (
      _ativo: boolean,
      _admin: boolean,
      opcoes?: { onRealtimeEvent?: (payload: unknown) => void },
    ) => {
      eventoRealtime.atual = opcoes?.onRealtimeEvent;
      return {
        orders: mockOrders,
        loadOrders: vi.fn(),
        updateOrderStatus: vi.fn(async () => {}),
        totalOrders: mockOrders.length,
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
const retirada = {
  retiradaNaLoja: true,
  enderecoDeRetirada: "Rua da Loja, 1",
};

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("Painel — o que a cliente RECEBE também diz 'Pronto para retirar' na retirada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null } });
    invoke.mockResolvedValue({ data: { enviados: 1 }, error: null });
    abrir = vi.fn();
    vi.stubGlobal("open", abrir);
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
  });

  async function montar(pedido: Order, selectedOrderId?: string) {
    mockOrders = [pedido];
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={selectedOrderId}
        />,
      );
    });
    await act(async () => {
      await esperar(20);
    });
  }

  async function avancarEPegarOPush(pedido: Order): Promise<string> {
    await montar(pedido, ID_DO_PEDIDO);
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
    return chamada?.[1].body.body as string;
  }

  async function whatsappDoCard(pedido: Order): Promise<string> {
    await montar(pedido);
    const botao = hospedeiro
      .querySelector("button[title=WhatsApp] svg")
      ?.closest("button");
    expect(botao).toBeTruthy();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(0);
    });
    expect(abrir).toHaveBeenCalledTimes(1);
    return decodeURIComponent(
      String(abrir.mock.calls[0][0]).split("?text=")[1] ?? "",
    );
  }

  async function avisoDoRealtime(customerData: unknown): Promise<string> {
    await montar(pedidoBase);
    await act(async () => {
      eventoRealtime.atual?.({
        eventType: "UPDATE",
        new: {
          id: ID_DO_PEDIDO,
          status: "shipping",
          customer_data: customerData,
        },
      });
      await esperar(0);
    });
    return String(
      vi
        .mocked(toast.info)
        .mock.calls.map(([t]) => String(t))
        .find((t) => t.includes("atualizado para")),
    );
  }

  it("PUSH da retirada: 'agora está: Pronto para retirar'", async () => {
    const corpo = await avancarEPegarOPush({ ...pedidoBase, ...retirada });
    expect(corpo).toContain("agora está: Pronto para retirar");
    expect(corpo).not.toContain("Trânsito");
  });

  it("PUSH da entrega: continua 'agora está: Em Trânsito' (controle)", async () => {
    const corpo = await avancarEPegarOPush(pedidoBase);
    expect(corpo).toContain("agora está: Em Trânsito");
  });

  it("WhatsApp da retirada pronta: 'Status: Pronto para retirar'", async () => {
    const texto = await whatsappDoCard({
      ...pedidoBase,
      ...retirada,
      status: "shipping",
    });
    expect(texto).toContain("Status: Pronto para retirar");
    expect(texto).not.toContain("Trânsito");
  });

  it("WhatsApp da entrega a caminho: continua 'Status: Em Trânsito' (controle)", async () => {
    const texto = await whatsappDoCard({ ...pedidoBase, status: "shipping" });
    expect(texto).toContain("Status: Em Trânsito");
  });

  it("aviso da lojista (realtime) de retirada: 'atualizado para Pronto para retirar'", async () => {
    const aviso = await avisoDoRealtime({
      pickup_address: "  Rua da Loja, 1 ",
    });
    expect(aviso).toBe("Pedido #3884BE atualizado para Pronto para retirar");
  });

  it("aviso da lojista (realtime) de entrega: continua 'Em Trânsito' (controle)", async () => {
    expect(await avisoDoRealtime({ address: {} })).toBe(
      "Pedido #3884BE atualizado para Em Trânsito",
    );
    expect(await avisoDoRealtime({ pickup_address: "   " })).toContain(
      "Em Trânsito",
    );
  });
});
