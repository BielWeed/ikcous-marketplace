// @vitest-environment jsdom
//
// "Recebi" na ficha aberta por LINK (?id=) de um pedido fora da página
// carregada. A gravação do hook (`useOrders.registrarPagamentoRecebido`)
// atualiza só os pedidos que estão em `orders`; esse pedido vive no estado
// `selectedOrder` da tela, que só se atualizava pelo evento ao vivo. Sem o
// tempo real (rede fraca, aba em segundo plano) a lojista registrava o
// recebimento, o banco gravava, e a ficha seguia oferecendo "Marcar como
// recebido" como se o dinheiro não tivesse entrado. Agora a resposta da
// gravação atualiza a ficha na hora.
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
let mockOrders: Order[] = [];
const registrarPagamentoRecebido = vi.fn();

vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ErroPedidoMudou: real.ErroPedidoMudou,
    useOrders: () => ({
      orders: mockOrders,
      loadOrders: vi.fn(),
      updateOrderStatus: vi.fn(),
      registrarPagamentoRecebido,
      totalOrders: mockOrders.length,
      isLoaded: true,
      loading: false,
    }),
  };
});

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
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
    open?: boolean;
    children: ReactNode;
  }) => (open === false ? null : <div>{children}</div>),
  // `DesfazerRecebimento` (que a ficha monta depois do "Recebi") usa o
  // AlertDialog sem `open` (não controlado): aqui ele fica sempre aberto.
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

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

const PEDIDO_ID = "pedido-deep-link-recebi";

function linhaCruaDoDeepLink() {
  return {
    id: PEDIDO_ID,
    status: "processing",
    payment_status: "pendente",
    payment_method: "cash",
    total: 120,
    subtotal: 100,
    shipping: 20,
    discount: 0,
    customer_name: "Cliente Teste",
    customer_data: { whatsapp: "34999999999" },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    items: [],
    address: null,
  };
}

function builderPedidoUnico(linha: unknown) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve({ data: linha, error: null }));
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: null }),
  );
  return builder;
}

describe("AdminOrdersView — Recebi na ficha aberta por link", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // `orders` do hook fica VAZIO: o pedido nunca está na página carregada.
    mockOrders = [];
    from.mockReset();
    from.mockImplementation(() => builderPedidoUnico(linhaCruaDoDeepLink()));
    registrarPagamentoRecebido.mockReset();
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
    vi.restoreAllMocks();
  });

  async function assentar() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function abrirPedido() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={PEDIDO_ID}
        />,
      );
    });
    await assentar();
  }

  function botao(texto: string) {
    return [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent === texto,
    );
  }

  async function marcarComoRecebido() {
    await act(async () => botao("Marcar como recebido")?.click());
    await act(async () => botao("Recebi")?.click());
    await assentar();
  }

  it("depois de 'Recebi', a ficha mostra 'Recebido em' e some o 'Marcar como recebido' (sem depender do tempo real)", async () => {
    registrarPagamentoRecebido.mockResolvedValue({
      // O valor que a RPC realmente devolve no "Recebi".
      payment_status: "recebido_na_entrega",
      pagamento_recebido_em: "2026-11-10T15:00:00Z",
      pagamento_recebido_por: "usuario-1",
    });
    await abrirPedido();
    expect(botao("Marcar como recebido")).toBeTruthy();

    await marcarComoRecebido();

    expect(registrarPagamentoRecebido).toHaveBeenCalledWith(PEDIDO_ID, true);
    expect(hospedeiro.textContent).toContain("Recebido em");
    expect(botao("Marcar como recebido")).toBeUndefined();
  });

  it("controle: se a gravação falha, a ficha continua oferecendo 'Marcar como recebido'", async () => {
    registrarPagamentoRecebido.mockRejectedValue(new Error("sem rede"));
    await abrirPedido();

    await marcarComoRecebido();

    expect(registrarPagamentoRecebido).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).not.toContain("Recebido em");
    expect(botao("Marcar como recebido")).toBeTruthy();
  });

  it("'Recebi' e depois 'Desfazer': a RPC devolve payment_status nulo e a ficha volta a ser de pedido NÃO pago (sem selo verde, sem 'está PAGO' ao cancelar)", async () => {
    registrarPagamentoRecebido
      .mockResolvedValueOnce({
        payment_status: "recebido_na_entrega",
        pagamento_recebido_em: "2026-11-10T15:00:00Z",
        pagamento_recebido_por: "usuario-1",
      })
      // O que a RPC vigente devolve ao desfazer: tudo nulo.
      .mockResolvedValueOnce({
        payment_status: null,
        pagamento_recebido_em: null,
        pagamento_recebido_por: null,
      });
    await abrirPedido();
    await marcarComoRecebido();
    expect(hospedeiro.textContent).toContain("Recebido na entrega");

    await act(async () => botao("Desfazer recebimento")?.click());
    await assentar();

    expect(registrarPagamentoRecebido).toHaveBeenLastCalledWith(
      PEDIDO_ID,
      false,
    );
    expect(hospedeiro.textContent).not.toContain("Recebido na entrega");
    expect(hospedeiro.textContent).toContain("Falta receber na entrega");
    expect(botao("Marcar como recebido")).toBeTruthy();

    await act(async () => botao("Cancelar pedido")?.click());
    await assentar();
    expect(document.body.textContent).toContain("Cancelar este pedido?");
    expect(document.body.textContent).not.toContain("PAGO");
  });
});
