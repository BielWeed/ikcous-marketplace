// @vitest-environment jsdom
//
// Rodada 2 do laudo Opus do PR #458 (achado A-1): o botão "Exportar CSV"
// baixa `paginatedOrders` — a PÁGINA visível (itemsPerPage=12), não o total
// filtrado — e o rótulo não avisava disso. Regra da casa (#451, "o app diz a
// verdade quando copia"): o texto do botão passa a carregar a contagem da
// página (`paginatedOrders.length`), nunca a do total filtrado
// (`totalOrders`). Este teste prova a DISTINÇÃO: monta `totalOrders` maior
// que a lista da página e verifica que o rótulo usa o tamanho da lista, não
// o total.
//
// Mesmo padrão de mock de admin-orders-filtro-que-filtra.test.tsx: `@/lib/
// supabase` mocado porque AdminOrdersView.tsx importa `supabase` no topo, e
// `useOrders`/`useAnalytics` mocados para controlar `orders` e `totalOrders`
// por teste, sem bater no banco.
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

function botaoExportar(hospedeiro: HTMLElement) {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.trim().startsWith("Exportar CSV"),
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

  it("com 3 pedidos NA PÁGINA e 25 no total filtrado, o rótulo mostra 3 — nunca 25", async () => {
    mockOrders = [pedido("a"), pedido("b"), pedido("c")];
    mockTotalOrders = 25; // total filtrado é bem maior que a página

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    const botao = botaoExportar(hospedeiro);
    expect(botao).toBeTruthy();
    expect(botao!.textContent?.trim()).toBe("Exportar CSV (3 desta página)");
    expect(botao!.textContent).not.toContain("25");
  });

  it("com 1 pedido na página, o singular fica correto: '1 desta página'", async () => {
    mockOrders = [pedido("a")];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    const botao = botaoExportar(hospedeiro);
    expect(botao!.textContent?.trim()).toBe("Exportar CSV (1 desta página)");
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
