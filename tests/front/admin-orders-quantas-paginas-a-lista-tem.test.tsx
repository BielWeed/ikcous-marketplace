// @vitest-environment jsdom
//
// Lista de Pedidos do painel: quantas páginas a tela diz que existem. São 12
// pedidos por página; o resto que não fecha uma página inteira ainda ocupa
// uma página a mais (13 pedidos = 2 páginas, não 1). Se a conta arredondasse
// para baixo, o pedido nº 13 existiria no contador e não teria botão para
// chegar até ele.
//
// Mesmo molde de painel-de-pedidos-volta-da-pagina-que-nao-existe-mais.test.tsx
// (`useOrders` e `useAnalytics` dublados: o que se mede é a tela).
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

describe("AdminOrdersView — quantas páginas a lista tem", () => {
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
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
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

  async function montar() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);
  }

  const paginacao = () =>
    hospedeiro.querySelector('[data-testid="paginacao-admin"]');
  const botao = (texto: string) =>
    [...(paginacao()?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes(texto),
    );

  it("12 pedidos cabem numa página só: contador sem botões", async () => {
    mockTotalOrders = 12;

    await montar();

    expect(paginacao()?.textContent).toContain("Exibindo 1 - 12 de 12");
    expect(botao("Próximo")).toBeUndefined();
  });

  it("13 pedidos pedem uma 2ª página: o botão Próximo existe e o contador para em 12", async () => {
    mockTotalOrders = 13;

    await montar();

    expect(paginacao()?.textContent).toContain("Exibindo 1 - 12 de 13");
    expect(botao("Próximo")).toBeDefined();
    expect((botao("Próximo") as HTMLButtonElement).disabled).toBe(false);
  });

  it("24 pedidos são exatamente 2 páginas: na 2ª, o Próximo está desligado e a página NÃO é zerada", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(1));
    mockTotalOrders = 24;

    await montar();
    // Dá tempo de um reset indevido acontecer antes de conferir.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(armazem.get("admin_orders_current_page")).toBe("1");
    expect(paginacao()?.textContent).toContain("Exibindo 13 - 24 de 24");
    expect((botao("Próximo") as HTMLButtonElement).disabled).toBe(true);
  });

  it("25 pedidos são 3 páginas: na 2ª, o Próximo ainda leva à 3ª", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(1));
    mockTotalOrders = 25;

    await montar();

    expect(paginacao()?.textContent).toContain("Exibindo 13 - 24 de 25");
    expect((botao("Próximo") as HTMLButtonElement).disabled).toBe(false);
  });

  it("página salva exatamente no fim (índice 2 com 24 pedidos = só 2 páginas) volta para a primeira", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(2));
    mockTotalOrders = 24;

    await montar();
    await esperarAte(() => armazem.get("admin_orders_current_page") === "0");

    expect(armazem.get("admin_orders_current_page")).toBe("0");
  });
});
