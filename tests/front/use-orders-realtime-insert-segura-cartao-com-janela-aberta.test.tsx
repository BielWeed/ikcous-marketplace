// @vitest-environment jsdom
//
// Página 1 cheia, a lojista com a janela de ação de um cartão aberta (Ações,
// Cancelar, Marcar como recebido, anular venda do balcão com o motivo já
// digitado...). Chega um pedido novo: ele entra no topo e a página é cortada
// em `pageSize`. Se o corte tirava justamente o cartão da janela aberta, o
// cartão desmontava e a janela sumia sem aviso, levando o texto digitado.
// Enquanto a tela diz que a janela está aberta, o corte não tira aquele
// cartão: a página fica com um a mais até a janela fechar, e o corte seguinte
// volta ao tamanho certo.
//
// Harness no molde de use-orders-realtime-insert-nao-passa-da-pagina.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const fromMock = vi.fn();
let aoInserir: ((payload: unknown) => unknown) | null = null;

function linha(id: string) {
  return {
    id,
    status: "pending",
    customer_name: "Cliente Teste",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
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
/** O que a tela diria: os cartões com a janela de ação aberta agora. */
let comJanelaAberta = new Set<string>();

async function montar() {
  const { useOrders } = await import("@/hooks/useOrders");
  function Sonda() {
    const { loadOrders, totalOrders, orders } = useOrders(true, true, {
      pedidosQueNaoSaemDaPagina: () => comJanelaAberta,
    });
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
  comJanelaAberta = new Set();
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

describe("pedido novo com a janela de ação de um cartão aberta", () => {
  it("o cartão da janela aberta não sai da página: ela fica com um a mais", async () => {
    await montar();
    carregaPagina(["a", "b", "c"], 7);
    await act(async () => {
      await visto.carregar(0, 3, "all");
    });
    comJanelaAberta = new Set(["c"]);

    await chegaPeloRealtime("novo");

    expect(visto.ids).toEqual(["novo", "a", "b", "c"]);
    expect(visto.totalOrders).toBe(8);
  });

  it("janela fechada: o corte seguinte volta ao tamanho da página", async () => {
    await montar();
    carregaPagina(["a", "b", "c"], 3);
    await act(async () => {
      await visto.carregar(0, 3, "all");
    });
    comJanelaAberta = new Set(["c"]);
    await chegaPeloRealtime("n1");
    expect(visto.ids).toEqual(["n1", "a", "b", "c"]);

    comJanelaAberta = new Set();
    await chegaPeloRealtime("n2");

    expect(visto.ids).toEqual(["n2", "n1", "a"]);
    expect(visto.totalOrders).toBe(5);
  });

  it("janela aberta num cartão que continua na página não muda o corte", async () => {
    await montar();
    carregaPagina(["a", "b", "c"], 3);
    await act(async () => {
      await visto.carregar(0, 3, "all");
    });
    comJanelaAberta = new Set(["a"]);

    await chegaPeloRealtime("novo");

    expect(visto.ids).toEqual(["novo", "a", "b"]);
  });
});
