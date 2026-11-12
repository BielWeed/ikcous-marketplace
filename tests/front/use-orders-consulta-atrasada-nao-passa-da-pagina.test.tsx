// @vitest-environment jsdom
//
// Painel do lojista, página 1 aberta: a lojista recarrega a lista e, ENQUANTO a
// consulta demora, um pedido novo chega pelo realtime (entra no topo e o último
// cartão sai, como já é o caso). A consulta atrasada volta com o retrato de
// ANTES do pedido novo. A mesclagem repunha o pedido novo no topo SEM reaplicar
// o limite: 13 cartões sob uma paginação de 12, e ao avançar a página o último
// pedido da página 1 aparecia DE NOVO (a lojista podia separar a mesma venda
// duas vezes). A página 1 tem de continuar com no máximo `pageSize` pedidos.
//
// Harness no molde de use-orders-realtime-insert-nao-passa-da-pagina.test.tsx.
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

/** Consulta que fica pendurada até `liberar` ser chamada (a recarga lenta). */
function consultaPendente(ids: string[], totalCount: number) {
  let liberar!: () => void;
  const resposta = new Promise<{ data: unknown; error: null }>((resolve) => {
    liberar = () =>
      resolve({
        data: { data: ids.map((id) => linha(id)), total_count: totalCount },
        error: null,
      });
  });
  rpc.mockImplementationOnce(() => ({ abortSignal: () => resposta }));
  return liberar;
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

const DOZE = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];

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

describe("pedido novo pelo realtime durante uma recarga da página 1", () => {
  it("a consulta atrasada volta e a página continua com pageSize pedidos: o novo no topo, o deslocado só na página seguinte", async () => {
    await montar();
    carregaPagina(DOZE, 30);
    await act(async () => {
      await visto.carregar(0, 12, "all");
    });
    expect(visto.ids).toEqual(DOZE);

    // A lojista recarrega; a consulta demora (o retrato dela é ANTERIOR ao novo).
    const liberar = consultaPendente(DOZE, 30);
    let recarga!: Promise<unknown>;
    await act(async () => {
      recarga = visto.carregar(0, 12, "all");
    });

    await chegaPeloRealtime("novo");
    expect(visto.ids).toEqual(["novo", ...DOZE.slice(0, 11)]);

    await act(async () => {
      liberar();
      await recarga;
    });

    expect(visto.ids).toHaveLength(12);
    expect(visto.ids).toEqual(["novo", ...DOZE.slice(0, 11)]);
    // O deslocado ("l") é o primeiro da página 2: o total (30 da resposta + 1
    // do novo) fecha a conta da paginação.
    expect(visto.ids).not.toContain("l");
    expect(visto.totalOrders).toBe(31);
  });

  it("controle: sem pedido novo no voo a lista é igual à resposta", async () => {
    await montar();
    carregaPagina(DOZE, 30);
    await act(async () => {
      await visto.carregar(0, 12, "all");
    });

    const liberar = consultaPendente(DOZE, 30);
    let recarga!: Promise<unknown>;
    await act(async () => {
      recarga = visto.carregar(0, 12, "all");
    });
    await act(async () => {
      liberar();
      await recarga;
    });

    expect(visto.ids).toEqual(DOZE);
    expect(visto.totalOrders).toBe(30);
  });

  it("controle: pedido novo no voo com a lista abaixo do limite não corta ninguém", async () => {
    await montar();
    carregaPagina(["a", "b", "c"], 3);
    await act(async () => {
      await visto.carregar(0, 12, "all");
    });

    const liberar = consultaPendente(["a", "b", "c"], 3);
    let recarga!: Promise<unknown>;
    await act(async () => {
      recarga = visto.carregar(0, 12, "all");
    });
    await chegaPeloRealtime("novo");
    await act(async () => {
      liberar();
      await recarga;
    });

    expect(visto.ids).toEqual(["novo", "a", "b", "c"]);
    expect(visto.totalOrders).toBe(4);
  });

  it("controle: pedido novo DEPOIS da consulta (caso já coberto) segue cortando o último", async () => {
    await montar();
    carregaPagina(DOZE, 30);
    await act(async () => {
      await visto.carregar(0, 12, "all");
    });

    await chegaPeloRealtime("novo");

    expect(visto.ids).toEqual(["novo", ...DOZE.slice(0, 11)]);
    expect(visto.totalOrders).toBe(31);
  });
});
