// @vitest-environment jsdom
//
// A varredura de cancelados (`fetchPedidosCancelados`, useOrders.ts) lê de
// 200 em 200 pela RPC `get_admin_orders_cancelados_recentes`, que pagina por
// POSIÇÃO (OFFSET). Um cancelamento novo entre duas páginas empurra a lista
// uma casa: o último da página 0 volta no começo da página 1. O laço só
// parava por contagem (`acumulado.length < total_count`), então:
//   * id repetido entrava duas vezes — o painel "Cancelados" (AlertasCancelados)
//     mostrava o pedido em dobro e somava o dinheiro dele em dobro;
//   * resposta que não anda (a mesma página de novo) enchia a lista até o
//     total com cópias, sem erro nenhum;
//   * página vazia antes do total fazia o laço pedir página atrás de página
//     até o teto de 25.
// A trava: id já visto não entra de novo; página CHEIA sem nada novo encerra
// com erro (o painel avisa que a lista pode estar incompleta); página que não
// vem cheia é o fim dos dados.
//
// Mock no molde de use-orders-cancelados-nao-baixa-o-banco-inteiro.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ data: [], error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
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
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const linha = (n: number) => ({
  id: `cancelado-${String(n).padStart(4, "0")}`,
  status: "cancelled",
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
});
/** Linhas `de` até `ate` (inclusive). */
const linhas = (de: number, ate: number) =>
  Array.from({ length: ate - de + 1 }, (_, i) => linha(de + i));

let host: HTMLDivElement;
let raiz: Root;
let paginasPedidas: number[];

/** Responde cada página pelo número dela; `total_count` fixo. */
function servidor(total: number, pagina: (p: number) => unknown[]) {
  rpc.mockImplementation((nome: string, args: { p_page: number }) => {
    if (nome !== "get_admin_orders_cancelados_recentes") {
      return Promise.resolve({ data: null, error: null });
    }
    paginasPedidas.push(args.p_page);
    return {
      abortSignal: () =>
        Promise.resolve({
          data: {
            data: pagina(args.p_page),
            total_count: total,
            fora_da_janela: 0,
          },
          error: null,
        }),
    };
  });
}

async function varrer(): Promise<{ lista: Order[]; incompleto: boolean }> {
  const { useOrders } = await import("@/hooks/useOrders");
  let buscar: () => Promise<Order[]> = async () => [];
  let lista: Order[] = [];
  let incompleto = false;
  function Sonda() {
    const {
      fetchPedidosCancelados,
      pedidosCancelados,
      pedidosCanceladosIncompleto,
    } = useOrders(true, true);
    useEffect(() => {
      buscar = fetchPedidosCancelados;
      lista = pedidosCancelados;
      incompleto = pedidosCanceladosIncompleto;
    });
    return null;
  }
  await act(async () => raiz.render(<Sonda />));
  await act(async () => {
    await buscar();
  });
  return { lista, incompleto };
}

const ids = (lista: Order[]) => lista.map((p) => p.id);

beforeEach(() => {
  rpc.mockReset();
  paginasPedidas = [];
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

describe("varredura de cancelados com trava de id repetido", () => {
  it("id que volta na página seguinte (lista empurrada uma casa) não entra duas vezes e o da fronteira não se perde", async () => {
    // Página 1 começa pelo último da página 0 (um cancelamento novo no meio).
    servidor(400, (p) =>
      p === 0 ? linhas(0, 199) : p === 1 ? linhas(199, 398) : linhas(399, 399),
    );
    const { lista, incompleto } = await varrer();
    expect(new Set(ids(lista)).size).toBe(lista.length);
    expect(lista).toHaveLength(400);
    expect(ids(lista)).toContain(linha(399).id);
    expect(incompleto).toBe(false);
  });

  it("página cheia que não traz nada novo encerra com erro, sem laço e sem lista duplicada", async () => {
    // Servidor que ignora a página pedida: devolve sempre as mesmas 200.
    servidor(1000, () => linhas(0, 199));
    const { lista, incompleto } = await varrer();
    expect(paginasPedidas).toEqual([0, 1]);
    expect(new Set(ids(lista)).size).toBe(lista.length);
    expect(incompleto).toBe(true);
  });

  it("página que não vem cheia é o fim dos dados: não pede página atrás de página até o teto", async () => {
    servidor(500, (p) => (p === 0 ? linhas(0, 199) : []));
    const { lista, incompleto } = await varrer();
    expect(paginasPedidas).toEqual([0, 1]);
    expect(lista).toHaveLength(200);
    expect(incompleto).toBe(true);
  });
});
