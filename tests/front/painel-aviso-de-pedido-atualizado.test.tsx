// @vitest-environment jsdom
//
// Caça 9, item 5: o aviso "Pedido #N atualizado para…" do realtime (a lojista
// vê quando OUTRA pessoa/o sistema mexe num pedido) estava errado de três
// jeitos: (a) saía em TODO UPDATE, mesmo sem mudar o status (salvar rastreio,
// receber pagamento…), repetindo o status anterior; (b) repetia o que a
// própria lojista acabou de fazer ("Status atualizado com sucesso" já falou);
// (c) PIX confirmado aparecia como "atualizado para Novo Pedido", sem dizer
// que foi PAGO. Mesmo casco de painel-retirada-avisa-pronto-para-retirar.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  esquecerAcaoPropriaDoPedido,
  marcarAcaoPropriaDoPedido,
} from "@/lib/acao-propria-do-painel";
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
  const { completarOldDoEvento } = await import(
    "@/lib/aviso-de-pedido-atualizado"
  );
  return {
    ErroPedidoMudou,
    useOrders: (
      _ativo: boolean,
      _admin: boolean,
      opcoes?: { onRealtimeEvent?: (payload: unknown) => void },
    ) => {
      // Faz o que o useOrders de verdade faz antes de entregar o evento ao
      // painel (prova no hook real: use-orders-realtime-completa-o-old-do-
      // aviso.test.tsx): o `old` do servidor traz só a chave primária, e o
      // "antes" de status/pagamento vem do pedido que a tela já tinha.
      eventoRealtime.atual = opcoes?.onRealtimeEvent
        ? (payload: any) =>
            opcoes.onRealtimeEvent?.(
              completarOldDoEvento(
                payload,
                mockOrders.find((o) => o.id === payload?.new?.id),
              ),
            )
        : undefined;
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
const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("Painel — aviso de pedido atualizado (realtime UPDATE)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    esquecerAcaoPropriaDoPedido(ID_DO_PEDIDO);
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

  // Formato REAL do evento: `old` só com a chave primária. O "antes" é o
  // pedido que a tela já tem (`antes`); sem ele, a tela não conhece o pedido.
  async function dispararUpdate(
    antes:
      | { status: Order["status"]; payment_status: Order["paymentStatus"] }
      | undefined,
    novo: Record<string, unknown>,
    old: Record<string, unknown> = { id: ID_DO_PEDIDO },
  ): Promise<string[]> {
    await montar(pedidoBase);
    mockOrders = antes
      ? [
          {
            ...pedidoBase,
            status: antes.status,
            paymentStatus: antes.payment_status,
          },
        ]
      : [];
    vi.mocked(toast.info).mockClear();
    await act(async () => {
      eventoRealtime.atual?.({
        eventType: "UPDATE",
        old,
        new: { id: ID_DO_PEDIDO, ...novo },
      });
      await esperar(0);
    });
    return vi.mocked(toast.info).mock.calls.map(([t]) => String(t));
  }

  it("status igual ao anterior (salvou rastreio, etc.): NÃO gera aviso", async () => {
    const avisos = await dispararUpdate(
      { status: "shipping", payment_status: "pago" },
      { status: "shipping", payment_status: "pago", tracking_code: "BR123" },
    );
    expect(avisos).toEqual([]);
  });

  it("status mudou (outra pessoa avançou): avisa com o nome da tela", async () => {
    const avisos = await dispararUpdate(
      { status: "pending", payment_status: "pago" },
      { status: "processing", payment_status: "pago" },
    );
    expect(avisos).toEqual(["Pedido #3884BE atualizado para Em Separação"]);
  });

  it("PIX confirmado (pagamento muda, status continua Novo Pedido): diz que o pagamento foi confirmado", async () => {
    const avisos = await dispararUpdate(
      { status: "pending", payment_status: "aguardando" },
      { status: "pending", payment_status: "pago" },
    );
    expect(avisos).toEqual(["Pagamento do pedido #3884BE confirmado"]);
    expect(avisos.join(" ")).not.toContain("Novo Pedido");
  });

  it("pagamento que já estava pago e continua pago não vira 'confirmado' de novo", async () => {
    const avisos = await dispararUpdate(
      { status: "pending", payment_status: "pago" },
      { status: "pending", payment_status: "pago" },
    );
    expect(avisos).toEqual([]);
  });

  it("pedido que a tela não conhece (fora da página): continua avisando, nunca engole uma mudança real", async () => {
    const avisos = await dispararUpdate(undefined, { status: "shipping" });
    expect(avisos).toEqual(["Pedido #3884BE atualizado para Em Trânsito"]);
  });

  it("compatibilidade: um 'old' completo vindo do servidor também vale", async () => {
    const igual = await dispararUpdate(
      undefined,
      { status: "shipping", payment_status: "pago" },
      { id: ID_DO_PEDIDO, status: "shipping", payment_status: "pago" },
    );
    expect(igual).toEqual([]);
    const mudou = await dispararUpdate(
      undefined,
      { status: "shipping", payment_status: "pago" },
      { id: ID_DO_PEDIDO, status: "processing", payment_status: "pago" },
    );
    expect(mudou).toEqual(["Pedido #3884BE atualizado para Em Trânsito"]);
  });

  it("a lojista acabou de avançar este pedido para este destino: o aviso do realtime não repete", async () => {
    marcarAcaoPropriaDoPedido(ID_DO_PEDIDO, "processing");
    const avisos = await dispararUpdate(
      { status: "pending", payment_status: "pago" },
      { status: "processing", payment_status: "pago" },
    );
    expect(avisos).toEqual([]);
  });

  it("a marca vale só para o destino que ela pediu: outra mudança do mesmo pedido avisa", async () => {
    marcarAcaoPropriaDoPedido(ID_DO_PEDIDO, "processing");
    const avisos = await dispararUpdate(
      { status: "processing", payment_status: "pago" },
      { status: "cancelled", payment_status: "pago" },
    );
    expect(avisos).toEqual(["Pedido #3884BE atualizado para Cancelado"]);
  });
});
