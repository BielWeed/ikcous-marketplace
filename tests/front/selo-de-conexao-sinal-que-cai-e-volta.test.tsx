// @vitest-environment jsdom
//
// Defeito medido (autônomo r34): o selo de conexão do painel (AdminLayout.tsx)
// ligava o "Sincronizado" (verde piscando) por 4 s ao voltar a internet, mas
// se o sinal caía de novo antes dos 4 s e voltava LENTO, o efeito era
// reexecutado sem ligar o flash outra vez e o limpador do cronômetro já tinha
// cancelado o desligamento: o selo ficava preso em "Sincronizado" para sempre,
// em vez de dizer "Lenta".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Diagnostico = {
  isOffline: boolean;
  latency: number;
  quality: "excellent" | "good" | "slow";
};

let diagnostico: Diagnostico = {
  isOffline: false,
  latency: 20,
  quality: "excellent",
};

vi.mock("@/hooks/useOnlineStatus", () => ({
  useConnectionDiagnostics: () => diagnostico,
  useOnlineStatus: () => diagnostico.isOffline,
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
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => builderSemContador()),
    rpc: vi.fn((nome: string) =>
      Promise.resolve({
        data:
          nome === "admin_devolucoes_listar"
            ? { total: 0, itens: [], contagem: { solicitada: 0 } }
            : { total_count: 0 },
        error: null,
      }),
    ),
    channel: vi.fn(() => {
      const canal: any = {};
      canal.on = vi.fn(() => canal);
      canal.subscribe = vi.fn(() => canal);
      return canal;
    }),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminLayout — selo de conexão com o sinal que cai e volta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    diagnostico = { isOffline: false, latency: 20, quality: "excellent" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function desenhar(novo: Partial<Diagnostico>) {
    diagnostico = { ...diagnostico, ...novo };
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
  }

  it("voltou boa, caiu em 1 s e voltou lenta: o selo diz Lenta, não Sincronizado", async () => {
    await desenhar({ isOffline: true, quality: "slow" });
    expect(hospedeiro.textContent).toContain("Sem internet");

    await desenhar({ isOffline: false, quality: "excellent" });
    expect(hospedeiro.textContent).toContain("Sincronizado");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await desenhar({ isOffline: true, quality: "slow" });
    expect(hospedeiro.textContent).toContain("Sem internet");

    await desenhar({ isOffline: false, quality: "slow" });
    expect(hospedeiro.textContent).not.toContain("Sincronizado");
    expect(hospedeiro.textContent).toContain("Lenta");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(hospedeiro.textContent).not.toContain("Sincronizado");
  });

  it("volta simples a uma conexão boa continua mostrando Sincronizado e depois some", async () => {
    await desenhar({ isOffline: true, quality: "slow" });
    await desenhar({ isOffline: false, quality: "excellent" });
    expect(hospedeiro.textContent).toContain("Sincronizado");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(hospedeiro.textContent).not.toContain("Sincronizado");
  });
});
