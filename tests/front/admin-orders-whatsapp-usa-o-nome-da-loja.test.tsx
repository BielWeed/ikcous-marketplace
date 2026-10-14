// @vitest-environment jsdom
//
// A mensagem de WhatsApp de status do pedido terminava com o nome do APP
// ("Obrigado por comprar na <branding.appName>") mesmo quando a lojista
// renomeou a loja. O resto do painel usa `config.storeName?.trim() ||
// branding.appName`. Mesmo casco de mocks de
// admin-orders-card-whatsapp-sem-destinatario.test.tsx.
import { branding } from "@/config/branding";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let nomeConfigurado: string | undefined;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: nomeConfigurado },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const abrirWhatsapp = vi.fn();
vi.mock("@/lib/abrir-whatsapp", () => ({
  abrirWhatsapp: (url: string) => abrirWhatsapp(url),
}));

let mockOrders: Order[] = [];

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

function pedidoFake(): Order {
  return {
    id: "pedido-whats",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
  } as Order;
}

describe("AdminOrdersView — WhatsApp de status chama a loja pelo nome que a lojista deu", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    abrirWhatsapp.mockClear();
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
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
    });

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
    vi.resetModules();
    mockOrders = [];
    nomeConfigurado = undefined;
  });

  async function tocarNoWhatsapp(): Promise<string> {
    mockOrders = [pedidoFake()];
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    const botao = hospedeiro
      .querySelector("button svg.lucide-message-circle")
      ?.closest("button");
    if (!botao) throw new Error("Botão de WhatsApp não está no card.");
    await act(async () => {
      botao.click();
    });
    expect(abrirWhatsapp).toHaveBeenCalledTimes(1);
    const url = abrirWhatsapp.mock.calls[0][0] as string;
    return decodeURIComponent(url.split("?text=")[1]);
  }

  it("loja renomeada: a mensagem usa o nome novo, nunca o do app", async () => {
    nomeConfigurado = "  Doces da Ana  ";
    const mensagem = await tocarNoWhatsapp();
    expect(mensagem).toContain("Obrigado por comprar na Doces da Ana!");
    expect(mensagem).not.toContain(`na ${branding.appName}!`);
  });

  it("sem nome configurado: cai no nome do app", async () => {
    nomeConfigurado = "   ";
    const mensagem = await tocarNoWhatsapp();
    expect(mensagem).toContain(`Obrigado por comprar na ${branding.appName}!`);
  });
});
