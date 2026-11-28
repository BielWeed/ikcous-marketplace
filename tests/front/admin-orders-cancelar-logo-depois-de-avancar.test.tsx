// @vitest-environment jsdom
//
// Lote 587 (28/11/2026): a lojista avança o pedido e logo em seguida o
// cancela. O envio do aviso do AVANÇO ainda estava no ar; quando a resposta
// dele chegava ("a cliente não ativou os avisos"), a tela reescrevia a
// confirmação com "mande pelo WhatsApp" e o botão do WhatsApp com a mensagem
// da etapa já abandonada, num pedido que agora está cancelado. O
// cancelamento também passa a ser o "último passo" do pedido
// (`ultimoAvancoRef`), e a resposta velha do avanço é descartada.
//
// Casco de mocks: admin-orders-rotina-de-despacho-na-bf (avanço e confirmação)
// e admin-orders-cancelar-pela-edge (botão "Cancelar pedido" da ficha).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  desligarDialogoDeConfirmacao,
  ligarDialogoDeConfirmacao,
} from "./duble-dialogo-de-confirmacao";

const updateOrderStatus = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const invoke = vi.fn();
const abrirWhatsapp = vi.fn();

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ...real,
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
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
  clearAnalyticsCache: () => {},
}));
vi.mock("@/lib/abrir-whatsapp", () => ({
  abrirWhatsapp: (url: string) => abrirWhatsapp(url),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const pedidoFicticio: Order = {
  id: "pedido-fic-cancela-depois",
  userId: "cliente-fic-cancela",
  customer: { name: "Cliente Fictícia", whatsapp: "11988887777" },
  items: [],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  paymentStatus: "pago",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};
let mockOrders: Order[] = [pedidoFicticio];

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type Acao = { label: string; onClick: () => void };
type OpcoesDoAviso = { id?: string; description?: string; action?: Acao };
const sucessos = () =>
  vi.mocked(toast.success).mock.calls as unknown as [string, OpcoesDoAviso?][];

describe("AdminOrdersView — cancelar logo depois de avançar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Resposta do envio do aviso do AVANÇO, segurada até o teste soltar.
  let soltarAvisoDoAvanco: (v: unknown) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    updateOrderStatus.mockReset();
    updateOrderStatus.mockResolvedValue({ gravadoNoBancoEm: null });
    invoke.mockReset();
    soltarAvisoDoAvanco = () => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise((r) => {
          soltarAvisoDoAvanco = r;
        }),
    );
    // Os envios seguintes (o aviso do cancelamento) respondem na hora.
    invoke.mockResolvedValue({ data: { enviados: 1, total: 1 }, error: null });
    mockOrders = [pedidoFicticio];
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
    vi.stubGlobal("ResizeObserver", ObservadorStub);
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    ligarDialogoDeConfirmacao();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    desligarDialogoDeConfirmacao();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function abrirAFicha() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={pedidoFicticio.id}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function avancar() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Avançar"),
    );
    expect(botao).toBeTruthy();
    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    // A confirmação do avanço já saiu; o envio do aviso segue pendurado.
    expect(sucessos()).toHaveLength(1);
    expect(sucessos()[0]![0]).toBe("Status atualizado com sucesso");
  }

  async function cancelar() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Cancelar pedido",
    );
    expect(botao).toBeTruthy();
    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(updateOrderStatus).toHaveBeenCalledTimes(2);
    expect(updateOrderStatus.mock.calls[1]?.[1]).toBe("cancelled");
  }

  async function soltarARespostaDoAvanco() {
    await act(async () => {
      soltarAvisoDoAvanco({ data: { enviados: 0, total: 0 }, error: null });
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("a resposta atrasada do aviso do avanço NÃO reescreve a confirmação nem oferece o WhatsApp da etapa abandonada", async () => {
    await abrirAFicha();
    await avancar();
    await cancelar();
    const antes = sucessos().length;

    await soltarARespostaDoAvanco();

    expect(sucessos()).toHaveLength(antes);
    const comWhatsapp = sucessos().filter(
      ([titulo, opcoes]) =>
        titulo === "Status atualizado." && opcoes?.action?.label === "WhatsApp",
    );
    expect(comWhatsapp).toHaveLength(0);
    expect(abrirWhatsapp).not.toHaveBeenCalled();
  });

  it("controle: avanço sozinho com a mesma resposta atrasada continua trocando a confirmação para o WhatsApp", async () => {
    await abrirAFicha();
    await avancar();

    await soltarARespostaDoAvanco();

    expect(sucessos()).toHaveLength(2);
    const [titulo, opcoes] = sucessos()[1]!;
    expect(titulo).toBe("Status atualizado.");
    expect(opcoes?.description).toBe(
      "A cliente não ativou os avisos no celular: mande pelo WhatsApp.",
    );
    expect(opcoes?.action?.label).toBe("WhatsApp");
  });
});
