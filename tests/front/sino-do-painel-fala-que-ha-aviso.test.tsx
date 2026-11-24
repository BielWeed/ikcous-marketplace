// @vitest-environment jsdom
//
// Acessibilidade (24/11): o sino do painel tinha `aria-label="Notificações"`
// FIXO e a bolinha vermelha é `aria-hidden` — quem usa leitor de tela ouvia
// "Notificações" igual com 5 pedidos esperando e com nada. Agora, quando há
// aviso confirmado, o nome do botão diz "Notificações, há avisos para
// conferir" (nos dois sinos: o do cabeçalho do celular e o da barra lateral).
// Sem aviso, o nome segue "Notificações". E quando o app NÃO CONSEGUIU conferir
// (consulta caída), o nome continua o de sempre: a dúvida já tem o `title` dela
// e não pode ser anunciada como "há avisos" que ninguém confirmou.
//
// Mesmo padrão de dublê do query builder thenable de
// sino-do-painel-acende-quando-consulta-falha.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let PEDIDOS_PENDENTES = 0;
let ERRO_NA_CONSULTA_DE_PEDIDOS = false;

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
    if (tabela !== "marketplace_orders" || ehRecebimento) {
      return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
    }
    return Promise.resolve(
      ERRO_NA_CONSULTA_DE_PEDIDOS
        ? { count: null, error: new Error("falha simulada de rede") }
        : { count: PEDIDOS_PENDENTES, error: null },
    ).then(resolve, reject);
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminLayout — o nome do sino fala quando há aviso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    PEDIDOS_PENDENTES = 0;
    ERRO_NA_CONSULTA_DE_PEDIDOS = false;
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montarEEsperar() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    // As contagens chegam por promessas: dá uns turnos para virarem estado.
    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const sinos = () =>
    ["aside", "header"].map(
      (lugar) =>
        hospedeiro.querySelector(
          `${lugar} button[aria-label^="Notificações"]`,
        ) as HTMLButtonElement,
    );

  it("com pedido esperando: os dois sinos dizem que há avisos para conferir", async () => {
    PEDIDOS_PENDENTES = 3;
    await montarEEsperar();
    const [lateral, cabecalho] = sinos();
    expect(lateral?.getAttribute("aria-label")).toBe(
      "Notificações, há avisos para conferir",
    );
    expect(cabecalho?.getAttribute("aria-label")).toBe(
      "Notificações, há avisos para conferir",
    );
  });

  it("controle: sem nada esperando, o nome segue 'Notificações'", async () => {
    await montarEEsperar();
    const [lateral, cabecalho] = sinos();
    expect(lateral?.getAttribute("aria-label")).toBe("Notificações");
    expect(cabecalho?.getAttribute("aria-label")).toBe("Notificações");
  });

  it("consulta caída: não anuncia 'há avisos' que ninguém confirmou", async () => {
    ERRO_NA_CONSULTA_DE_PEDIDOS = true;
    await montarEEsperar();
    const [lateral, cabecalho] = sinos();
    expect(cabecalho?.getAttribute("title")).toBe("Falha ao conferir avisos");
    expect(lateral?.getAttribute("aria-label")).toBe("Notificações");
    expect(cabecalho?.getAttribute("aria-label")).toBe("Notificações");
  });
});
