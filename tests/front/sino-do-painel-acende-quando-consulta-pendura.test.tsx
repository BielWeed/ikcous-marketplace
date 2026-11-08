// @vitest-environment jsdom
//
// Rede "pendurada" (conecta e nao responde): a bolinha do sino (AdminLayout)
// espera as seis consultas de contagem juntas, e o aviso "nao consegui
// conferir" so era gravado DEPOIS de todas terminarem. Uma so consulta parada
// deixava a bolinha sem veredito para sempre — nem acesa por duvida, nem
// apagada de verdade — e a retentativa automatica nunca era armada.
//
// Prazo por consulta: passou, a consulta conta como falha, o sino acende por
// duvida ("!") e a retentativa roda. Mesmo dublê de
// sino-do-painel-acende-quando-consulta-falha.test.tsx, enxuto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A consulta de PEDIDOS PARA PREPARAR (a que nao e a de entregues) nunca responde.
let PENDURAR_PEDIDOS = false;
let consultasDePedidos = 0;

function criarContagemBuilder(tabela: string) {
  const builder: any = {};
  let ehRecebimento = false;
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.eq = vi.fn((coluna: string, valor: string) => {
    if (coluna === "status" && valor === "delivered") ehRecebimento = true;
    return builder;
  });
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase — mesmo padrão dos vizinhos deste diretório.
  builder.then = (resolve: any, reject?: any) => {
    if (tabela === "marketplace_orders" && !ehRecebimento) {
      consultasDePedidos += 1;
      if (PENDURAR_PEDIDOS) return new Promise(() => {}).then(resolve, reject);
    }
    return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => criarContagemBuilder(tabela)),
    rpc: vi.fn((nome: string) =>
      Promise.resolve(
        nome === "admin_devolucoes_listar"
          ? {
              data: { total: 0, itens: [], contagem: { solicitada: 0 } },
              error: null,
            }
          : { data: { total_count: 0 }, error: null },
      ),
    ),
    channel: vi.fn(() => {
      const canal: any = {};
      canal.on = vi.fn(() => canal);
      canal.subscribe = vi.fn();
      return canal;
    }),
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

async function montarPainel(raiz: Root, hospedeiro: HTMLDivElement) {
  const { AdminLayout } = await import("@/components/layouts/AdminLayout");
  await act(async () => {
    raiz.render(
      <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
        <div />
      </AdminLayout>,
    );
  });
  const sino = hospedeiro.querySelector(
    'header button[aria-label="Notificações"]',
  );
  expect(sino).toBeTruthy();
  return sino as HTMLButtonElement;
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AdminLayout — o sino acende quando uma consulta nunca responde", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    PENDURAR_PEDIDOS = false;
    consultasDePedidos = 0;
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

  it("a consulta de pedidos pendura: passado o prazo o sino ACENDE por duvida", async () => {
    PENDURAR_PEDIDOS = true;
    const sino = await montarPainel(raiz, hospedeiro);

    // Dentro do prazo ainda nao ha veredito: nao acende por antecipacao.
    await passar(5_000);
    expect(sino.querySelector("span")?.textContent).not.toBe("!");

    await passar(20_000);

    expect(sino.querySelector("span")?.textContent).toBe("!");
    expect(sino.getAttribute("title")).toBe("Falha ao conferir avisos");
    expect(hospedeiro.textContent).toContain("Contagem atual não confirmada.");
  });

  it("a duvida arma a retentativa: a consulta e feita de novo sozinha", async () => {
    PENDURAR_PEDIDOS = true;
    await montarPainel(raiz, hospedeiro);
    await passar(20_000);
    const antes = consultasDePedidos;

    // A rede volta: a retentativa (recuo de alguns segundos) acha tudo em dia.
    PENDURAR_PEDIDOS = false;
    await passar(30_000);

    expect(consultasDePedidos).toBeGreaterThan(antes);
    const sino = hospedeiro.querySelector(
      'header button[aria-label="Notificações"]',
    );
    expect(sino?.querySelector("span")?.textContent).not.toBe("!");
  });

  it("controle: nada pendurado e nada pendente — o sino NAO acende", async () => {
    const sino = await montarPainel(raiz, hospedeiro);
    await passar(30_000);

    expect(sino.querySelector("span")).toBeNull();
    expect(sino.getAttribute("title")).not.toBe("Falha ao conferir avisos");
  });
});
