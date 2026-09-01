// @vitest-environment jsdom
//
// Laudo 0109 (A-5) — o filtro de payment_status passou a rodar NO BANCO
// (lista E contagem), mas o estado vazio continuava dizendo "O filtro só
// olha a página atual. Navegue pelas páginas…" — instrução de um mecanismo
// que não existe mais, que manda a lojista paginar à toa.
//
// Casco: admin-orders-filtro-que-filtra.test.tsx (mesmos mocks).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

let mockOrders: Order[] = [];
let mockTotalOrders = 0;
let mockLoadOrders: ReturnType<typeof vi.fn>;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: mockLoadOrders,
    updateOrderStatus: vi.fn(),
    totalOrders: mockTotalOrders,
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

describe("AdminOrdersView — estado vazio do filtro de pagamento é honesto (laudo 0109, A-5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map<string, string>();
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

    mockLoadOrders = vi.fn();
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
    mockTotalOrders = 0;
  });

  it("filtro de pagamento sem resultado: manda limpar o filtro, não paginar", async () => {
    armazem.set("admin_orders_payment_filter", JSON.stringify("aguardando"));
    mockOrders = [];
    mockTotalOrders = 0;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    const tela = hospedeiro.textContent ?? "";

    // Título e corpo novos — o filtro roda no banco, a saída é limpar.
    expect(tela).toContain("Nenhum pedido com esse filtro de pagamento");
    expect(tela).toContain(
      "Nenhum pedido com esse status de pagamento. Limpe o filtro para ver todos os pedidos.",
    );

    // O texto órfão (instrução de paginação de um filtro client-side que
    // morreu) não pode mais aparecer.
    expect(tela).not.toContain("O filtro só olha a página atual");
    expect(tela).not.toContain("Navegue pelas páginas");
    expect(tela).not.toContain(
      "Nenhum pedido desta página tem este status de pagamento",
    );
  });
});
