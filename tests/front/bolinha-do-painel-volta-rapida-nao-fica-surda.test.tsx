// @vitest-environment jsdom
//
// Defeito: ao esconder a aba, o AdminLayout chamava `removeChannel` sem
// esperar. Voltando antes de o servidor confirmar a saída, `channel()` do
// realtime-js devolvia o canal ANTIGO (ainda saindo, mesmo nome), e
// `.subscribe()` não fazia nada (só entra canal fechado). Confirmada a saída,
// o canal sumia e ninguém mais ouvia: a bolinha de pedidos ficava surda até a
// próxima volta à aba. O tempo real aqui é o fiel (fixtures/tempo-real-fiel).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  conferencias: 0,
  tempoReal: null as null | ReturnType<
    typeof import("./fixtures/tempo-real-fiel").criarTempoRealFiel
  >,
}));

function builderSemContador() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: 0, error: null }).then(resolve, reject);
  return builder;
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
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
vi.mock("@/lib/supabase", async () => {
  const { criarTempoRealFiel } = await import("./fixtures/tempo-real-fiel");
  h.tempoReal = criarTempoRealFiel();
  return {
    supabase: {
      from: vi.fn(() => builderSemContador()),
      rpc: vi.fn((nome: string) => {
        if (nome === "get_admin_questions_paged") h.conferencias += 1;
        return Promise.resolve({
          data:
            nome === "admin_devolucoes_listar"
              ? { total: 0, itens: [], contagem: { solicitada: 0 } }
              : { total_count: 0 },
          error: null,
        });
      }),
      channel: (nome: string) => h.tempoReal!.channel(nome),
      removeChannel: (canal: any) => h.tempoReal!.removeChannel(canal),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function esperarAte(
  oQue: string,
  condicao: () => boolean,
  timeoutMs = 5000,
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(`${oQue}: não aconteceu em ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });
}

let visibilidade: "visible" | "hidden" = "visible";
function mudarVisibilidade(novo: "visible" | "hidden") {
  visibilidade = novo;
  return act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("AdminLayout — esconder e voltar rápido não deixa a bolinha surda", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    visibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilidade,
    });
    h.conferencias = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("voltou antes de o servidor confirmar a saída: depois da confirmação os dois canais estão juntados e um pedido reconta", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    await esperarAte("primeira contagem", () => h.conferencias >= 1);
    const tempoReal = h.tempoReal!;
    expect(tempoReal.juntados("admin-layout-orders-badge")).toHaveLength(1);

    await mudarVisibilidade("hidden");
    // Volta ANTES da confirmação da saída (rede lenta, troca rápida de aba).
    await mudarVisibilidade("visible");
    await act(async () => {
      tempoReal.confirmarSaidas();
    });
    await esperarAte(
      "os dois canais juntados de novo",
      () =>
        tempoReal.juntados("admin-layout-orders-badge").length === 1 &&
        tempoReal.juntados("admin-layout-questions-badge").length === 1,
    );

    const antes = h.conferencias;
    await act(async () => {
      tempoReal.emitir("marketplace_orders");
    });
    await esperarAte("recontar com o pedido", () => h.conferencias > antes);
  });
});
