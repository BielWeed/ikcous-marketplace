// @vitest-environment jsdom
//
// Link de pedido que NÃO existe (id truncado, apagado, de outra loja) não é
// falha de conexão. A busca avulsa da ficha (`fetchSingleOrder`) usa
// `.single()`: sem linha volta PGRST116; id que nem é uuid volta 22P02. Antes,
// os dois caíam no catch genérico e a tela dizia "Verifique a conexão e tente
// novamente" para um link que nunca vai funcionar. Agora dizem "Pedido não
// encontrado". Falha de verdade (rede, 500) continua dizendo conexão.
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
let mockOrders: Order[] = [];
let erroDaBusca: { code?: string; message: string } = { message: "" };

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

function builderQueFalha() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() =>
    Promise.resolve({ data: null, error: erroDaBusca }),
  );
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: null }),
  );
  return builder;
}

describe("AdminOrdersView — link de pedido que não existe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockOrders = [];
    from.mockReset();
    from.mockImplementation(() => builderQueFalha());
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

  async function abrirPedido(id: string) {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={id}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it.each([
    ["PGRST116 (nenhum pedido com esse id)", "PGRST116", "0 rows"],
    [
      "22P02 (id truncado, não é uuid)",
      "22P02",
      'invalid input syntax for type uuid: "1111"',
    ],
  ])(
    "%s: diz 'Pedido não encontrado', nunca 'conexão'",
    async (_nome, code, message) => {
      erroDaBusca = { code, message };
      const texto = await abrirPedido("1111");

      expect(texto).toContain("Pedido não encontrado");
      expect(texto).toContain("Voltar aos pedidos");
      expect(texto).not.toContain("Verifique a conexão");
      expect(texto).not.toContain("Não foi possível carregar");
      expect(toast.error).toHaveBeenCalledWith("Pedido não encontrado");
      expect(toast.error).not.toHaveBeenCalledWith(
        "Erro ao carregar detalhes do pedido",
      );
    },
  );

  it("controle: falha de verdade (outro código) continua dizendo 'Verifique a conexão'", async () => {
    erroDaBusca = { code: "08006", message: "connection failure" };
    const texto = await abrirPedido("11111111-1111-1111-1111-111111111111");

    expect(texto).toContain("Não foi possível carregar");
    expect(texto).toContain("Verifique a conexão");
    expect(texto).not.toContain("Pedido não encontrado");
    expect(toast.error).toHaveBeenCalledWith(
      "Erro ao carregar detalhes do pedido",
    );
  });
});
