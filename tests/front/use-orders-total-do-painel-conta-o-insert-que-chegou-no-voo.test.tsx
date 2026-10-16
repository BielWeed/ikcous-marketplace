// @vitest-environment jsdom
//
// Painel do lojista: uma página (`get_admin_orders_paged`) que volta DEPOIS de
// um pedido novo ter chegado pelo realtime. A lista preserva o pedido que
// chegou no voo (a resposta é um retrato anterior a ele), mas o total — e o
// cache do total — eram sobrescritos com a contagem velha do retrato: o
// "Exibindo X–Y de Z" e a paginação contavam a menos. O total recebe a mesma
// reconciliação da lista: soma os pedidos inseridos em tempo real que a
// resposta não contém.
//
// Harness no molde de use-orders-cancelados-insert-recarrega-com-debounce.test.tsx.
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

/** A resposta do servidor só chega quando o teste mandar. */
function respostaEmVoo(ids: string[], totalCount: number) {
  let entregar!: () => void;
  const promessa = new Promise((resolve) => {
    entregar = () =>
      resolve({
        data: { data: ids.map((id) => linha(id)), total_count: totalCount },
        error: null,
      });
  });
  rpc.mockImplementationOnce(() => ({ abortSignal: () => promessa }));
  return entregar;
}
/** Pedido novo (o SELECT pontual do realtime responde com ele). */
function chegaPeloRealtime(id: string, status = "pending") {
  fromMock.mockImplementationOnce(() => ({
    select: () => ({
      eq: () => ({
        single: () =>
          Promise.resolve({ data: linha(id, { status }), error: null }),
      }),
    }),
  }));
  return act(async () => {
    aoInserir!({ eventType: "INSERT", new: { id } });
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  // O total em cache vive no módulo: cada teste parte de um módulo novo.
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

describe("total do painel com pedido que chegou pelo realtime durante a leitura", () => {
  it("a resposta sem o pedido novo não encolhe o total: soma o que chegou no voo", async () => {
    await montar();
    const entregar = respostaEmVoo(["a", "b", "c"], 3);
    let devolvido!: { orders: { id: string }[]; total: number };
    let promessa!: Promise<unknown>;
    await act(async () => {
      promessa = visto.carregar(0, 12, "all").then((r) => {
        devolvido = r;
      });
    });
    await chegaPeloRealtime("novo");
    expect(visto.ids).toContain("novo");
    expect(visto.totalOrders).toBe(1); // 0 do cache + o insert
    await act(async () => {
      entregar();
      await promessa;
    });
    expect(visto.ids).toEqual(["novo", "a", "b", "c"]);
    expect(visto.totalOrders).toBe(4);
    expect(devolvido.total).toBe(4);
  });

  it("o cache do total também leva a contagem reconciliada", async () => {
    await montar();
    const entregar = respostaEmVoo(["a", "b"], 2);
    let promessa!: Promise<unknown>;
    await act(async () => {
      promessa = visto.carregar(0, 12, "all");
    });
    await chegaPeloRealtime("novo");
    await act(async () => {
      entregar();
      await promessa;
    });
    expect(visto.totalOrders).toBe(3);
    // Outra instância do painel nasce com o total do cache de módulo.
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(host);
    rpc.mockImplementation(() => ({
      abortSignal: () => new Promise(() => {}),
    }));
    await montar();
    expect(visto.totalOrders).toBe(3);
  });

  it("dois pedidos que chegaram no voo somam dois", async () => {
    await montar();
    const entregar = respostaEmVoo(["a"], 1);
    let promessa!: Promise<unknown>;
    await act(async () => {
      promessa = visto.carregar(0, 12, "all");
    });
    await chegaPeloRealtime("n1");
    await chegaPeloRealtime("n2");
    await act(async () => {
      entregar();
      await promessa;
    });
    expect(visto.totalOrders).toBe(3);
  });

  it("a resposta que JÁ traz o pedido novo não conta duas vezes", async () => {
    await montar();
    const entregar = respostaEmVoo(["novo", "a"], 2);
    let promessa!: Promise<unknown>;
    await act(async () => {
      promessa = visto.carregar(0, 12, "all");
    });
    await chegaPeloRealtime("novo");
    await act(async () => {
      entregar();
      await promessa;
    });
    expect(visto.totalOrders).toBe(2);
  });

  it("pedido fora do filtro da consulta não entra na lista nem no total", async () => {
    await montar();
    const entregar = respostaEmVoo(["a"], 1);
    let promessa!: Promise<unknown>;
    await act(async () => {
      promessa = visto.carregar(0, 12, "cancelled");
    });
    await chegaPeloRealtime("novo", "pending");
    await act(async () => {
      entregar();
      await promessa;
    });
    expect(visto.ids).toEqual(["a"]);
    expect(visto.totalOrders).toBe(1);
  });

  it("sem pedido no voo, o total é o do servidor", async () => {
    await montar();
    respostaEmVoo(["a", "b"], 57)();
    await act(async () => {
      await visto.carregar(0, 12, "all");
    });
    expect(visto.totalOrders).toBe(57);
  });
});
