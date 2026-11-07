// @vitest-environment jsdom
//
// A bolinha do sino (AdminLayout) e a lista de avisos (useAvisosDoLojista)
// tem de contar as MESMAS avaliacoes. A avaliacao pendente (ainda nao
// publicada) tem de continuar acendendo o sino mesmo depois de a loja
// responder — responder nao a publica; so o Aprovar —, entao as duas consultas
// pedem "sem resposta OU pendente". Este teste prende o filtro da bolinha:
// com o `.is("merchant_reply", null)` antigo, a pendente ja respondida ficaria
// de fora da conta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consultasDeAvaliacoes: Array<Array<[string, ...unknown[]]>> = [];

function criarBuilder(tabela: string) {
  const calls: Array<[string, ...unknown[]]> = [];
  if (tabela === "reviews") consultasDeAvaliacoes.push(calls);
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.is = vi.fn((...argumentos: unknown[]) => {
    calls.push(["is", ...argumentos]);
    return builder;
  });
  builder.or = vi.fn((filtro: string) => {
    calls.push(["or", filtro]);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null }));
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: 0, error: null }).then(resolve, reject);
  return builder;
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => criarBuilder(tabela)),
    rpc: vi.fn((nome: string) =>
      Promise.resolve({
        data:
          nome === "admin_devolucoes_listar"
            ? { total: 0, itens: [], contagem: { solicitada: 0 } }
            : { total_count: 0 },
        error: null,
      }),
    ),
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

describe("AdminLayout — a bolinha conta avaliacao sem resposta OU aguardando aprovacao", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    consultasDeAvaliacoes.length = 0;
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    // AdminLayout chama `window.matchMedia` no mount; ausente no jsdom.
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
  });

  it("a consulta de avaliacoes usa o filtro 'sem resposta ou pendente', sem o .is antigo", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(consultasDeAvaliacoes.length).toBeGreaterThan(0);
    const consulta = consultasDeAvaliacoes[0];
    expect(consulta).toContainEqual([
      "or",
      "merchant_reply.is.null,status.eq.pendente",
    ]);
    expect(consulta.some(([nome]) => nome === "is")).toBe(false);
  });
});
