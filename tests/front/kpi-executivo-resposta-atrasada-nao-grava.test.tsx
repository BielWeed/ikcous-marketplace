// @vitest-environment jsdom
//
// Lote 1 do laudo "o que falta" (29/08, achado pedidos 17): pausar/ativar
// produtos em sequência rápida dispara vários `fetchExecutiveSummary(true)`
// concorrentes (AdminProductsView.tsx:404-412). As chamadas não tinham
// guarda de ordem: a resposta que chegasse POR ÚLTIMO gravava o cache, o
// estado e o broadcast — e a última podia ser a resposta da PRIMEIRA
// chamada (rede lenta), deixando "Volume Total"/"Capital Alocado" com o
// retrato de até 30 s atrás sem nada denunciar. Degrau 1 da escada: mente
// em silêncio sobre dinheiro.
//
// O conserto é o padrão da casa (OrderDetailsView.tsx:303-306, "melhor um
// dado de um segundo atrás do que piscar para..."): a resposta de uma
// chamada que já não é a mais recente NÃO grava estado — ela devolve o
// dado a quem chamou e pronto.
//
// Prova: duas chamadas forçadas; a B (mais recente) resolve primeiro; a A
// (antiga) resolve depois. O valor que ficar no hook tem de ser o de B.
// No código de antes, A sobrescrevia B e este teste morria.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "adm-1" } }),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: { init: async () => ({ put: async () => {} }) },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "adm-1" } } },
        error: null,
      }),
    },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function statsComVolume(totalRevenue: number) {
  // O teste só lê executive.totalRevenue; o resto é o mínimo para o fluxo
  // do hook e do broadcast passarem sem tropeçar.
  return {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue,
      totalOrders: 1,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: totalRevenue,
      avgTicketTrend: 0,
      activeCustomers: 1,
      activeCustomersTrend: 0,
    },
    revenueHistory: [],
    topProducts: [],
    inventoryAlerts: 0,
  } as any;
}

describe("fetchExecutiveSummary: resposta atrasada de chamada antiga não grava o KPI", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("a chamada B (recente) vence a A (antiga) que resolveu por último", async () => {
    let resolverA!: (v: unknown) => void;
    let resolverB!: (v: unknown) => void;
    rpc
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolverA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolverB = resolve;
          }),
      );

    const { useAnalytics } = await import("@/hooks/useAnalytics");
    // Captura via efeito: a catraca react-hooks proíbe reassign E mutação
    // de valor de fora durante o render — efeito colateral pertence a um
    // efeito. Cada render atualiza a captura com o hook vivo daquele render.
    const captura: { atual?: ReturnType<typeof useAnalytics> } = {};
    function Hospedeiro() {
      const h = useAnalytics();
      useEffect(() => {
        captura.atual = h;
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Hospedeiro />);
    });

    let promessaA!: Promise<unknown>;
    let promessaB!: Promise<unknown>;
    await act(async () => {
      // A sai primeiro (o lojista pausou o produto 1); B sai em seguida
      // (pausou o produto 2). O macrotask dá tempo de as duas passarem o
      // `getSession` e chegarem à RPC — ambas pendentes.
      promessaA = captura.atual!.fetchExecutiveSummary(
        true,
      ) as Promise<unknown>;
      promessaB = captura.atual!.fetchExecutiveSummary(
        true,
      ) as Promise<unknown>;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(rpc).toHaveBeenCalledTimes(2);

    // A rede responde B primeiro...
    await act(async () => {
      resolverB({ data: statsComVolume(222.22), error: null });
      await promessaB;
    });

    expect(captura.atual!.stats?.executive?.totalRevenue).toBe(222.22);

    // ...e a resposta de A chega ATRASADA — e não pode sobrescrever.
    await act(async () => {
      resolverA({ data: statsComVolume(111.11), error: null });
      await promessaA;
    });

    expect(captura.atual!.stats?.executive?.totalRevenue).toBe(222.22);
  });
});
