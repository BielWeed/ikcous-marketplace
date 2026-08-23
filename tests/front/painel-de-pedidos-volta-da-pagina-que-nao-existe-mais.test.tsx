// @vitest-environment jsdom
//
// Achado 2 do lote 1 (caça-defeitos): filtro "Em Aberto", 20 pedidos -> 2
// páginas. A lojista fica na página 2 (índice 1), separa e entrega os
// pedidos; no dia seguinte sobram 8 -> 1 página. `currentPage` volta do
// localStorage valendo 1 (a 2ª página), a consulta devolve lista vazia, e
// como `totalPages = 1` o bloco de paginação nem é renderizado — não existe
// botão para voltar à página 0. Ela vê "nenhum pedido" com 8 esperando
// separação.
//
// Mesmo padrão de mock de admin-orders-filtro-que-filtra.test.tsx:
// `@/lib/supabase` mocado porque AdminOrdersView.tsx importa `supabase` no
// topo, e `useOrders`/`useAnalytics` mocados para controlar `totalOrders`,
// `isLoaded` e `loading` por teste.
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

let mockOrders: Order[] = [];
let mockTotalOrders = 0;
let mockIsLoaded = true;
let mockLoading = false;
let mockLoadOrders: ReturnType<typeof vi.fn>;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: mockLoadOrders,
    updateOrderStatus: vi.fn(),
    totalOrders: mockTotalOrders,
    isLoaded: mockIsLoaded,
    loading: mockLoading,
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

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` — sem
 * `@testing-library/react` (não instalado neste projeto). Mesmo helper de
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

describe("AdminOrdersView — a página some volta da página que não existe mais", () => {
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
    mockOrders = [];
    mockTotalOrders = 0;
    mockIsLoaded = true;
    mockLoading = false;
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
  });

  it("presa na página 1 (2ª página) com só 8 pedidos (1 página) e carregamento já assentado -> volta pra página 0", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(1));
    mockTotalOrders = 8; // itemsPerPage=12 -> totalPages=1, página 1 não existe mais
    mockIsLoaded = true;
    mockLoading = false;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await esperarAte(() => armazem.get("admin_orders_current_page") === "0");

    expect(armazem.get("admin_orders_current_page")).toBe("0");
  });

  it("controle negativo: página 1 (2ª página) VÁLIDA com 30 pedidos (3 páginas) não é resetada", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(1));
    mockTotalOrders = 30; // itemsPerPage=12 -> totalPages=3, página 1 continua válida
    mockIsLoaded = true;
    mockLoading = false;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);
    // Dá tempo de um possível reset indevido acontecer antes de conferir.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(armazem.get("admin_orders_current_page")).toBe("1");
  });

  it("controle de carregamento: ainda carregando (isLoaded=false, totalPages momentaneamente 0) não zera a página 1", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(1));
    mockTotalOrders = 0; // valor provisório de quem ainda está buscando
    mockIsLoaded = false;
    mockLoading = true;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(armazem.get("admin_orders_current_page")).toBe("1");
  });
});
