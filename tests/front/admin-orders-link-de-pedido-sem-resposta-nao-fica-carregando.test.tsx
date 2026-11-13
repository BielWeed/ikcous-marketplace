// @vitest-environment jsdom
//
// Pedido aberto por LINK (?id=) com a conexão pendurada: a busca avulsa da
// ficha (`fetchSingleOrder`) não tinha prazo. Se o servidor nunca respondia, o
// spinner "Carregando Pedido" ficava para sempre, sem "Voltar" e sem saída — a
// lojista tinha de fechar o app. Agora a busca corre contra 15 s (`comPrazo`):
// estourou, cai no mesmo caminho de qualquer falha de rede (aviso + tela de
// erro com "Voltar aos pedidos"). A revalidação silenciosa continua sem tela de
// erro: a ficha que já está na tela não pode ser trocada por ela.
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
let mockOrders: Order[] = [];

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

const PEDIDO_ID = "pedido-deep-link-sem-resposta";
const PRAZO_DA_BUSCA_MS = 15_000;

function linhaCruaDoDeepLink() {
  return {
    id: PEDIDO_ID,
    status: "processing",
    payment_status: "pago",
    payment_method: "pix",
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

/** `.single()` que NUNCA responde: a conexão ficou pendurada. */
function builderPendurado() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() => new Promise(() => {}));
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: null }),
  );
  return builder;
}

function builderQueResponde(linha: unknown) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve({ data: linha, error: null }));
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: null, error: null }),
  );
  return builder;
}

describe("AdminOrdersView — link de pedido com a conexão pendurada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockOrders = [];
    from.mockReset();
    from.mockImplementation(() => builderPendurado());
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
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderizar(onNavigate = vi.fn()) {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={onNavigate}
          active={true}
          selectedOrderId={PEDIDO_ID}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function texto() {
    return hospedeiro.textContent ?? "";
  }

  it("a busca nunca responde: dentro do prazo segue carregando; no estouro sai do spinner e mostra o erro com 'Voltar aos pedidos'", async () => {
    const onNavigate = vi.fn();
    await renderizar(onNavigate);
    expect(texto()).toContain("Carregando Pedido");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_BUSCA_MS - 1_000);
    });
    expect(texto()).toContain("Carregando Pedido");
    expect(texto()).not.toContain("Não foi possível carregar");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(texto()).not.toContain("Carregando Pedido");
    expect(texto()).toContain("Não foi possível carregar");
    expect(texto()).toContain("Verifique a conexão");
    expect(texto()).not.toContain("Pedido não encontrado");
    expect(toast.error).toHaveBeenCalledWith(
      "Erro ao carregar detalhes do pedido",
    );

    const voltar = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Voltar aos pedidos"),
    );
    expect(voltar).toBeTruthy();
    await act(async () => {
      voltar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-orders");
  });

  it("controle: a busca que responde dentro do prazo mostra a ficha e nunca a tela de erro", async () => {
    from.mockImplementation(() => builderQueResponde(linhaCruaDoDeepLink()));
    await renderizar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_BUSCA_MS + 1_000);
    });

    expect(texto()).toContain("Cliente Teste");
    expect(texto()).not.toContain("Não foi possível carregar");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a revalidação silenciosa que pendura não troca a ficha pela tela de erro", async () => {
    from.mockImplementation(() => builderQueResponde(linhaCruaDoDeepLink()));
    await renderizar();
    expect(texto()).toContain("Cliente Teste");

    from.mockImplementation(() => builderPendurado());
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_BUSCA_MS + 1_000);
    });

    expect(texto()).toContain("Cliente Teste");
    expect(texto()).not.toContain("Não foi possível carregar");
    expect(texto()).not.toContain("Carregando Pedido");
  });
});
