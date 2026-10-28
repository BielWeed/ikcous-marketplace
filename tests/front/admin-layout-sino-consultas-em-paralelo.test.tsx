// @vitest-environment jsdom
//
// O sino do painel fazia SEIS consultas em fila (pedidos, perguntas,
// avaliações, devoluções, privacidade, recebimentos): no 3G, cada ida e volta
// esperava a anterior e o sino levava segundos para ficar certo. Elas são
// independentes, então saem juntas — e uma que falha não pode apagar nem
// zerar a contagem das outras.
//
// Cada consulta falsa demora 100 ms (relógio falso): em fila seriam 600 ms;
// em paralelo, ~100 ms.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ATRASO_MS = 100;
const PEDIDOS_PARA_PREPARAR = 4;

let iniciadas: string[] = [];
let respondidas: string[] = [];
let avaliacoesFalham = false;

function criarBuilder(tabela: string) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  // A janela do sino (política de devolução) é lida antes da consulta de
  // recebimentos; responde na hora para não somar tempo à consulta.
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null }));
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) => {
    iniciadas.push(tabela);
    const resposta =
      tabela === "reviews" && avaliacoesFalham
        ? { count: null, error: { message: "falhou" } }
        : {
            count: tabela === "marketplace_orders" ? PEDIDOS_PARA_PREPARAR : 0,
            error: null,
          };
    return new Promise((ok) =>
      setTimeout(() => {
        respondidas.push(tabela);
        ok(resposta);
      }, ATRASO_MS),
    ).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => criarBuilder(tabela)),
    rpc: vi.fn((nome: string) => {
      iniciadas.push(nome);
      const data =
        nome === "admin_devolucoes_listar"
          ? { total: 0, itens: [], contagem: { solicitada: 0 } }
          : { total_count: 0 };
      return new Promise((ok) =>
        setTimeout(() => {
          respondidas.push(nome);
          ok({ data, error: null });
        }, ATRASO_MS),
      );
    }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn(),
    fetchCategoryAnalytics: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ loadOrders: vi.fn() }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminLayout — o sino confere as seis fontes em paralelo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    iniciadas = [];
    respondidas = [];
    avaliacoesFalham = false;
    vi.useFakeTimers();
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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
    vi.useRealTimers();
  });

  async function montar() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
  }

  const textoDePedidos = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Pedidos"),
    )?.textContent ?? "";

  it("as seis consultas saem juntas, sem esperar uma pela outra", async () => {
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(iniciadas).toHaveLength(6);
  });

  it("o sino fica pronto em ~1 atraso, não em 6", async () => {
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ATRASO_MS + 50);
    });
    expect(respondidas).toHaveLength(6);
    expect(textoDePedidos()).toContain(`Pedidos${PEDIDOS_PARA_PREPARAR}`);
  });

  it("uma fonte que falha não derruba nem zera as outras", async () => {
    avaliacoesFalham = true;
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ATRASO_MS + 50);
    });
    expect(respondidas).toHaveLength(6);
    expect(textoDePedidos()).toContain(`Pedidos${PEDIDOS_PARA_PREPARAR}`);
  });
});
