// @vitest-environment jsdom
//
// Defeitos medidos (autônomo r30): a bolinha de avisos do painel
// (AdminLayout.tsx) só tinha UMA aba escutando o tempo real — a "líder" — e as
// demais dependiam de um aviso pelo BroadcastChannel. Se a líder era uma aba da
// vitrine (não do painel) ou estava escondida, a bolinha do painel visível
// ficava parada. Além disso, ao voltar a internet com o painel aberto o selo
// dizia "Sincronizado", mas ninguém recontava.
//
// O que este teste prova:
// 1. Uma aba do painel VISÍVEL que não é líder abre os próprios canais de
//    pedidos e perguntas, e um evento deles dispara nova contagem.
// 2. Esconder e voltar não dobra os canais (continuam dois, um por tabela
//    observada) — sem tempestade de assinaturas.
// 3. Evento "online" com a aba visível recontam UMA vez; com a aba escondida,
//    nada (aba escondida não bate na rede).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let handlersPorCanal: Map<string, (payload?: any) => void> = new Map();
let canaisAbertos: string[] = [];
let canaisRemovidos = 0;
// Uma conferência = uma chamada da RPC de perguntas pendentes (uma por rodada).
let conferencias = 0;

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

// Aba SEGUIDORA: é justamente o caso que ficava parado.
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
    rpc: vi.fn((nome: string) => {
      if (nome === "get_admin_questions_paged") conferencias += 1;
      return Promise.resolve({
        data:
          nome === "admin_devolucoes_listar"
            ? { total: 0, itens: [], contagem: { solicitada: 0 } }
            : { total_count: 0 },
        error: null,
      });
    }),
    channel: vi.fn((nome: string) => {
      canaisAbertos.push(nome);
      const canal: any = {};
      canal.on = vi.fn(
        (_tipo: string, cfg: any, handler: (payload?: any) => void) => {
          handlersPorCanal.set(`${nome}#${cfg.table}`, handler);
          return canal;
        },
      );
      // O SDK devolve o próprio canal em `.subscribe()`; o componente guarda
      // esse retorno para poder fechar o canal ao esconder a aba.
      canal.subscribe = vi.fn(() => canal);
      return canal;
    }),
    removeChannel: vi.fn(() => {
      canaisRemovidos += 1;
    }),
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

function pausa(ms: number) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

let visibilidade: "visible" | "hidden" = "visible";

function mudarVisibilidade(novo: "visible" | "hidden") {
  visibilidade = novo;
  return act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("AdminLayout — toda aba visível do painel mantém a bolinha", () => {
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
    handlersPorCanal = new Map();
    canaisAbertos = [];
    canaisRemovidos = 0;
    conferencias = 0;
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

  async function montar() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    await esperarAte(() => conferencias >= 1);
  }

  it("aba seguidora visível abre os próprios canais e um evento dispara nova contagem", async () => {
    await montar();

    expect(canaisAbertos.sort()).toEqual([
      "admin-layout-orders-badge",
      "admin-layout-questions-badge",
    ]);
    const depoisDaMontagem = conferencias;

    const handler = handlersPorCanal.get(
      "admin-layout-orders-badge#marketplace_orders",
    );
    expect(handler).toBeTruthy();
    await act(async () => {
      handler!();
    });

    await esperarAte(() => conferencias > depoisDaMontagem);
    expect(conferencias).toBe(depoisDaMontagem + 1);
  });

  it("esconder e voltar à aba não dobra os canais: fecha os dois e reabre os dois", async () => {
    await montar();
    expect(canaisAbertos).toHaveLength(2);

    await mudarVisibilidade("hidden");
    expect(canaisRemovidos).toBe(2);

    await mudarVisibilidade("visible");
    // Reabriu o mesmo par — nunca mais que dois canais vivos ao mesmo tempo.
    expect(canaisAbertos).toHaveLength(4);
    expect(canaisRemovidos).toBe(2);
  });

  it("voltou a internet com a aba visível: recontam uma vez", async () => {
    await montar();
    const depoisDaMontagem = conferencias;

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });

    // Rajada de "online" cai na janela de coalescência: UMA contagem só.
    await esperarAte(() => conferencias > depoisDaMontagem);
    await pausa(1200);
    expect(conferencias).toBe(depoisDaMontagem + 1);
  });

  it("voltou a internet com a aba escondida: não bate na rede", async () => {
    await montar();
    await mudarVisibilidade("hidden");
    const antes = conferencias;

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await pausa(1300);

    expect(conferencias).toBe(antes);
  });

  it("evento chega e a aba esconde antes da janela de 1 s: a contagem armada não roda escondida", async () => {
    await montar();
    const antes = conferencias;

    const handler = handlersPorCanal.get(
      "admin-layout-orders-badge#marketplace_orders",
    );
    await act(async () => {
      handler!();
    });
    // A contagem agrupada já está armada (1 s); a aba esconde logo depois.
    await mudarVisibilidade("hidden");
    await pausa(1300);

    expect(conferencias).toBe(antes);
  });
});
