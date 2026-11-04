// @vitest-environment jsdom
//
// Painel do lojista, página 1 aberta: cada pedido novo que chegava pelo
// realtime entrava no topo SEM tirar ninguém de baixo. Com 12 cartões na tela
// e um pedido novo, a tela mostrava 13 sob "Exibindo 1 - 12 de 13" (e mais um
// a cada venda, até a próxima recarga). A lista da página 1 tem de continuar
// com no máximo `pageSize` pedidos; o que foi empurrado para fora é o
// primeiro da página 2 (o total sobe em 1, então a paginação fecha a conta).
//
// Harness no molde de use-orders-total-do-painel-conta-o-insert-que-chegou-no-voo.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const fromMock = vi.fn();
let aoInserir: ((payload: unknown) => unknown) | null = null;

function linha(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "pending",
    customer_name: "Cliente Teste",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  };
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc,
    from: (...args: unknown[]) => fromMock(...args),
    channel: () => ({
      on: (_e: string, _f: unknown, handler: (payload: unknown) => unknown) => {
        aoInserir = handler;
        return { subscribe: () => ({}) };
      },
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Visto {
  totalOrders: number;
  ids: string[];
  carregar: (
    page?: number,
    pageSize?: number,
    status?: string,
  ) => Promise<{ orders: { id: string }[]; total: number }>;
}
let visto: Visto;
let host: HTMLDivElement;
let raiz: Root;

async function montar() {
  const { useOrders } = await import("@/hooks/useOrders");
  function Sonda() {
    const { loadOrders, totalOrders, orders } = useOrders(true, true);
    useEffect(() => {
      visto = {
        totalOrders,
        ids: orders.map((o) => o.id),
        carregar: loadOrders as Visto["carregar"],
      };
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
}

function carregaPagina(ids: string[], totalCount: number) {
  rpc.mockImplementationOnce(() => ({
    abortSignal: () =>
      Promise.resolve({
        data: { data: ids.map((id) => linha(id)), total_count: totalCount },
        error: null,
      }),
  }));
}

/** Pedido novo (o SELECT pontual do realtime responde com ele). */
function chegaPeloRealtime(id: string) {
  fromMock.mockImplementationOnce(() => ({
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: linha(id), error: null }),
      }),
    }),
  }));
  return act(async () => {
    aoInserir!({ eventType: "INSERT", new: { id } });
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetModules();
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => armazem.get(k) ?? null,
    setItem: (k: string, v: string) => void armazem.set(k, v),
    removeItem: (k: string) => void armazem.delete(k),
  });
  rpc.mockReset();
  fromMock.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(async () => {
  await act(async () => {
    raiz.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe("pedido novo pelo realtime com a página 1 aberta", () => {
  it("a página cheia continua com pageSize pedidos: o último sai, o total sobe", async () => {
    await montar();
    carregaPagina(["a", "b", "c"], 7);
    await act(async () => {
      await visto.carregar(0, 3, "all");
    });
    expect(visto.ids).toEqual(["a", "b", "c"]);

    await chegaPeloRealtime("novo");

    expect(visto.ids).toEqual(["novo", "a", "b"]);
    expect(visto.totalOrders).toBe(8);
  });

  it("uma rajada de pedidos nunca passa de pageSize e o mais novo fica no topo", async () => {
    await montar();
    carregaPagina(["a", "b", "c"], 3);
    await act(async () => {
      await visto.carregar(0, 3, "all");
    });

    await chegaPeloRealtime("n1");
    await chegaPeloRealtime("n2");
    await chegaPeloRealtime("n3");
    await chegaPeloRealtime("n4");

    expect(visto.ids).toEqual(["n4", "n3", "n2"]);
    expect(visto.totalOrders).toBe(7);
  });

  it("o eco do mesmo pedido, mesmo depois de ele sair da página, não volta a entrar", async () => {
    await montar();
    carregaPagina(["a", "b", "c"], 3);
    await act(async () => {
      await visto.carregar(0, 3, "all");
    });
    await chegaPeloRealtime("n1");
    await chegaPeloRealtime("n2");
    await chegaPeloRealtime("n3");
    await chegaPeloRealtime("n4"); // n1 já saiu da página
    expect(visto.ids).toEqual(["n4", "n3", "n2"]);

    await chegaPeloRealtime("n1"); // eco tardio do mesmo pedido

    expect(visto.ids).toEqual(["n4", "n3", "n2"]);
    expect(visto.totalOrders).toBe(7);
  });

  it("página com espaço sobrando (menos que pageSize) não perde ninguém", async () => {
    await montar();
    carregaPagina(["a", "b"], 2);
    await act(async () => {
      await visto.carregar(0, 12, "all");
    });

    await chegaPeloRealtime("novo");

    expect(visto.ids).toEqual(["novo", "a", "b"]);
    expect(visto.totalOrders).toBe(3);
  });

  it("sem consulta anterior (nenhuma página carregada ainda) não corta nada: não há tamanho de página a respeitar", async () => {
    await montar();

    await chegaPeloRealtime("novo");

    expect(visto.ids).toEqual(["novo"]);
    expect(visto.totalOrders).toBe(1);
  });
});
