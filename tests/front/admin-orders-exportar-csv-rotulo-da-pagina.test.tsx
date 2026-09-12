// @vitest-environment jsdom
// A exportação agora consulta o filtro inteiro: o rótulo acompanha totalOrders.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
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

/** Espera até `condicao()` ficar verdadeira — sem `@testing-library/react`
 * (não instalado neste projeto). Mesmo helper de
 * admin-orders-filtro-que-filtra.test.tsx. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

/** Desde 12/09/2026 o botão é compacto (cabe na linha da busca): o texto
 *  VISÍVEL é só "CSV" e o rótulo por extenso — com a contagem do filtro — é o
 *  NOME ACESSÍVEL. A propriedade guardada por este arquivo não mudou: o número
 *  tem de ser o do filtro inteiro, nunca o da página. Só mudou onde ele é lido. */
function nomeAcessivel(b: HTMLButtonElement) {
  return (b.getAttribute("aria-label") || "").trim();
}

function botaoExportar(hospedeiro: HTMLElement) {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    nomeAcessivel(b).startsWith("Exportar CSV"),
  );
}

function pedido(id: string): Order {
  return {
    id,
    customer: { name: "João Silva", whatsapp: "11987654321" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    paymentStatus: "aguardando",
    createdAt: new Date(2026, 8, 8, 9, 0).toISOString(),
    updatedAt: new Date(2026, 8, 8, 9, 0).toISOString(),
    cancelledAfterShipping: false,
  };
}

describe("AdminOrdersView — o botão de exportar CSV diz quantos pedidos vai gravar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
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

  it("com 3 pedidos na página e 25 no filtro, o rótulo mostra os 25 que serão exportados", async () => {
    mockOrders = [pedido("a"), pedido("b"), pedido("c")];
    mockTotalOrders = 25; // total filtrado é bem maior que a página

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    const botao = botaoExportar(hospedeiro);
    expect(botao).toBeTruthy();
    expect(nomeAcessivel(botao!)).toBe("Exportar CSV (25 no filtro)");
    expect(botao!.disabled).toBe(false);
  });

  it("com 1 pedido no filtro, o rótulo mostra esse total", async () => {
    mockOrders = [pedido("a")];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    const botao = botaoExportar(hospedeiro);
    expect(nomeAcessivel(botao!)).toBe("Exportar CSV (1 no filtro)");
  });

  it("com a lista vazia, o botão continua desabilitado", async () => {
    mockOrders = [];
    mockTotalOrders = 0;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    const botao = botaoExportar(hospedeiro);
    expect(botao).toBeTruthy();
    expect(botao!.disabled).toBe(true);
  });
});
