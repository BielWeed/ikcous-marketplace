// @vitest-environment jsdom
//
// Laudo novos-ângulos 01/09, achado C4 (ponta 3): o canal de badges do
// painel chamava `fetchInitialCounts` (3 consultas) a CADA evento de
// `marketplace_orders`/`questions`/`answers` — uma rajada de atualizações
// de pedido (import, reconciliação, vários clientes pagando) virava
// rajada de triplo de consultas no banco.
//
// O conserto é coalescência: a primeira conferência agenda; as que
// chegarem dentro da janela são absorvidas por ela. Montagem dispara
// conferência IMEDIATA como sempre; retorno de foco também.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let handlersPorCanal: Map<string, (payload?: any) => void> = new Map();
// O marcador de conferência é a consulta de PEDIDOS do fetchInitialCounts —
// não "qualquer consulta": a mesma conferência também lê reviews e
// perguntas, e contar tudo dobraria o número.
let conferenciasDePedidos = 0;

function builderOrders() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) => {
    conferenciasDePedidos += 1;
    return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
  };
  return builder;
}

function builderSemContador() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: 0, error: null }).then(resolve, reject);
  return builder;
}

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn(),
    fetchCategoryAnalytics: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ loadOrders: vi.fn() }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) =>
      tabela === "marketplace_orders" ? builderOrders() : builderSemContador(),
    ),
    rpc: vi.fn(() =>
      Promise.resolve({ data: { total_count: 0 }, error: null }),
    ),
    channel: vi.fn((_nome: string) => {
      const canal: any = {};
      canal.on = vi.fn(
        (_tipo: string, cfg: any, handler: (payload?: any) => void) => {
          handlersPorCanal.set(`${_nome}#${cfg.table}`, handler);
          return canal;
        },
      );
      canal.subscribe = vi.fn();
      return canal;
    }),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 5000, passoMs = 25 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

describe("AdminLayout — rajada de eventos vira UMA conferência de badges", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
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
  }, 15000);

  beforeEach(() => {
    handlersPorCanal = new Map();
    conferenciasDePedidos = 0;
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
  });

  it("três eventos em rajada produzem uma única conferência nova", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");

    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    // A montagem confere na hora (comportamento preservado).
    await esperarAte(() => conferenciasDePedidos >= 1);
    const depoisDaMontagem = conferenciasDePedidos;

    const canalDePedidos = "admin-layout-orders-badge#marketplace_orders";
    const handler = handlersPorCanal.get(canalDePedidos);
    expect(handler).toBeTruthy();

    // Rajada: três eventos quase simultâneos.
    await act(async () => {
      handler!();
      handler!();
      handler!();
    });

    // Dentro da janela de coalescência ninguém corre ao banco.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(conferenciasDePedidos).toBe(depoisDaMontagem);

    // Passada a janela, EXATAMENTE uma conferência acontece.
    await esperarAte(() => conferenciasDePedidos > depoisDaMontagem);
    expect(conferenciasDePedidos).toBe(depoisDaMontagem + 1);
  });

  it("um evento isolado também confere (a coalescência não engole o primeiro)", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");

    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    await esperarAte(() => conferenciasDePedidos >= 1);
    const depoisDaMontagem = conferenciasDePedidos;

    const handler = handlersPorCanal.get(
      "admin-layout-questions-badge#questions",
    );
    expect(handler).toBeTruthy();
    await act(async () => {
      handler!();
    });

    await esperarAte(() => conferenciasDePedidos > depoisDaMontagem);
    expect(conferenciasDePedidos).toBe(depoisDaMontagem + 1);
  });
});
