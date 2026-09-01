// @vitest-environment jsdom
//
// Laudo 0109 (A-8) — a ficha do pedido copiava endereço e rastreio com
// `navigator.clipboard.writeText(x)` sem await/catch e já mostrava
// "Copiado" + toast de sucesso MESMO quando a cópia falhava. Agora quem
// copia é o util `copiarParaClipboard` e a tela só comemora com `true`.
//
// Montagem pelo AdminOrdersView com selectedOrderId — mesmo caminho de
// admin-orders-status-erro-cru-nao-duplica-toast.test.tsx, que já provou
// que OrderDetail renderiza de verdade nesse casco.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let clipboardWriteText: (texto: string) => Promise<void> = vi
  .fn()
  .mockResolvedValue(undefined);

function stubClipboard() {
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      writeText: (...args: Parameters<typeof clipboardWriteText>) =>
        clipboardWriteText(...args),
    },
    configurable: true,
  });
}

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

// Laudo 0109 (onda 2, A-3): a AdminOrdersView passou a consumir useStore
// (nome da loja no recibo) — o teste monta a view e precisa do provedor.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";

const pedidoBase: Order = {
  id: "pedido-copia-endereco",
  customer: {
    name: "Cliente Teste",
    whatsapp: "34999999999",
    address: "Rua das Flores",
    number: "123",
    neighborhood: "Centro",
    city: "Monte Carmelo",
    state: "MG",
    cep: "38500-000",
  },
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

let mockOrders: Order[] = [pedidoBase];

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

describe("OrderDetail — copiar endereço não finge sucesso (laudo 0109, A-8)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Os mocks do sonner são do módulo (compartilhados entre os testes
    // deste arquivo) — limpa as chamadas do teste anterior antes de tudo.
    vi.clearAllMocks();
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    stubClipboard();
    mockOrders = [pedidoBase];
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
    Reflect.deleteProperty(window.navigator, "clipboard");
    vi.unstubAllGlobals();
  });

  async function montarFicha() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={pedidoBase.id}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function botaoCopiarEndereco() {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Copiar Endereço",
    );
  }

  it("clipboard recusa: toast de erro, nenhum toast de sucesso, botão continua 'Copiar'", async () => {
    clipboardWriteText = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError"));

    await montarFicha();

    const botao = botaoCopiarEndereco();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Não foi possível copiar.");
    // O estado "copiado" não mentiu: o botão continua oferecendo copiar.
    expect(botaoCopiarEndereco()?.textContent).toContain("Copiar");
    expect(botaoCopiarEndereco()?.textContent).not.toContain("Copiado");
  });

  it("clipboard aceita: toast de sucesso e botão vira 'Copiado' (controle)", async () => {
    await montarFicha();

    const botao = botaoCopiarEndereco();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.success).toHaveBeenCalledWith(
      "Endereço copiado para a área de transferência!",
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(botaoCopiarEndereco()?.textContent).toContain("Copiado");
  });
});
