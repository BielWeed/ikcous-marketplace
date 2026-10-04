// @vitest-environment jsdom
//
// F6 (04/10/2026): o cliente vê o pedido como "#3884BE" (6 últimos
// caracteres do id, em MAIÚSCULAS — `numeroDoPedido`). As mensagens que o
// PAINEL manda a ele — o push de "status atualizado", o WhatsApp do card da
// lista e o WhatsApp da ficha — saíam com o mesmo número em minúsculas
// ("#3884be"): duas grafias do mesmo pedido na cabeça de quem recebe.
//
// Mesmo casco de painel-avancar-rele-pedido-mudou.test.tsx (view montada de
// verdade, `useOrders` dublado), só que aqui o que se mede é o TEXTO que sai.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const ID_DO_PEDIDO = "pedido-c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

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

describe("Painel — o aviso ao cliente usa o número que ele vê (#3884BE)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrders = [pedido];
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

  async function montar(selectedOrderId?: string) {
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

  const textoDoWhatsapp = () => {
    expect(abrir).toHaveBeenCalledTimes(1);
    const url = String(abrir.mock.calls[0][0]);
    return decodeURIComponent(url.split("?text=")[1] ?? "");
  };

  it("push de 'status atualizado': o corpo diz '#3884BE'", async () => {
    await montar(ID_DO_PEDIDO);

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
    const corpo = chamada?.[1].body.body as string;
    expect(corpo).toContain("#3884BE");
    expect(corpo).not.toContain("#3884be");
  });

  it("WhatsApp do card da lista: a mensagem diz '#3884BE'", async () => {
    await montar();

    const botao = hospedeiro
      .querySelector("button svg.lucide-message-circle")
      ?.closest("button");
    expect(botao).toBeTruthy();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(0);
    });

    const texto = textoDoWhatsapp();
    expect(texto).toContain("#3884BE");
    expect(texto).not.toContain("#3884be");
  });

  it("WhatsApp da ficha do pedido: a mensagem diz '#3884BE'", async () => {
    await montar(ID_DO_PEDIDO);

    const botao = hospedeiro.querySelector(
      'button[title="Conversar no WhatsApp"]',
    );
    expect(botao).toBeTruthy();
    await act(async () => {
      botao?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(0);
    });

    const texto = textoDoWhatsapp();
    expect(texto).toContain("#3884BE");
    expect(texto).not.toContain("#3884be");
  });

  it("cabeçalho da ficha do pedido: 'Pedido #3884BE', o mesmo que o cliente vê", async () => {
    await montar(ID_DO_PEDIDO);

    const titulo = hospedeiro.querySelector("h1");
    expect(titulo?.textContent).toBe("Pedido #3884BE");
  });
});
