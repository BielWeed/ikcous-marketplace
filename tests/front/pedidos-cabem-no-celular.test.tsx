// @vitest-environment jsdom
//
// Onda J (J2) do painel simples — Pedidos cabe no celular de 360px:
//  (a) "Finalizados" usa o separador de milhar pt-BR (1150 -> "1.150");
//  (b) o placeholder da busca é curto ("Buscar…") e cabe no campo; o nome
//      acessível do campo continua "Buscar pedidos" (label sr-only);
//  (c) o botão de WhatsApp do cartão do pedido tem alvo de toque de 44px
//      (`size-11`), não 40px;
//  (d) P-J3: o botão de exportar continua escrito "CSV" (decisão do dono).
//
// Mesmo casco de mocks de admin-orders-card-whatsapp-sem-destinatario.
import type { Order } from "@/types";
import type { AdminOrdersView as TipoTela } from "@/views/admin/AdminOrdersView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
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

// `delivered_total` da RPC `get_admin_analytics_v2` chega ao front como
// `stats.deliveredTotal` (mapeado em useAnalytics).
// O objeto é ESTÁVEL entre renders (a view o põe em dependência de efeito:
// um literal novo a cada chamada giraria o efeito sem parar).
const { statsDoPainel, buscarResumo } = vi.hoisted(() => ({
  statsDoPainel: { deliveredTotal: 1150, paidOnCancelled: 0 },
  buscarResumo: vi.fn(),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: statsDoPainel,
    fetchExecutiveSummary: buscarResumo,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function pedidoFake(): Order {
  return {
    id: "pedido-celular",
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
  };
}

describe("AdminOrdersView — Pedidos cabe no celular (onda J, J2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  // O `import()` frio da tela é caro (puxa a árvore inteira): fica na
  // preparação, uma vez, com timeout explícito — não dentro de cada caso
  // nem do `beforeEach`. `import type` é apagado na compilação.
  let Tela: typeof TipoTela;

  beforeAll(async () => {
    ({ AdminOrdersView: Tela } = await import("@/views/admin/AdminOrdersView"));
  }, 60_000);

  beforeEach(async () => {
    mockOrders = [pedidoFake()];
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

    const AdminOrdersView = Tela;
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
  });

  it("'Finalizados' mostra 1.150 (milhar pt-BR), não 1150", () => {
    const rotulo = Array.from(hospedeiro.querySelectorAll("p")).find(
      (el) => el.textContent === "Finalizados",
    );
    expect(rotulo).toBeTruthy();
    const valor =
      rotulo?.parentElement?.parentElement?.querySelector("h3")?.textContent;
    expect(valor).toBe("1.150");
  });

  it("a busca tem placeholder curto 'Buscar…' e nome acessível 'Buscar pedidos'", () => {
    const campo = hospedeiro.querySelector<HTMLInputElement>("#orders-search");
    expect(campo).toBeTruthy();
    expect(campo?.placeholder).toBe("Buscar…");
    const rotulo = hospedeiro.querySelector('label[for="orders-search"]');
    expect(rotulo?.textContent).toBe("Buscar pedidos");
  });

  it("o botão de WhatsApp do cartão tem alvo de 44px (size-11)", () => {
    const icone = hospedeiro.querySelector("button svg.lucide-message-circle");
    const botao = icone?.closest("button");
    expect(botao).toBeTruthy();
    expect(botao?.classList.contains("size-11")).toBe(true);
    expect(botao?.classList.contains("size-10")).toBe(false);
  });

  it("P-J3: o botão de exportar continua escrito 'CSV'", () => {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "CSV",
    );
    expect(botao).toBeTruthy();
  });
});
