// @vitest-environment jsdom
//
// A tela de Notificacoes nao se atualizava sozinha (08/11/2026): o sino da
// barra relê as contagens (tempo real de pedidos e perguntas, foco, internet),
// mas a lista so relia ao voltar o foco. Resultado visto: a bolinha acesa no
// sino e a tela, aberta ao lado, dizendo "Tudo em dia".
//
// O conserto e o mais curto: quando uma releitura do sino ve um numero DIFERENTE
// do que ele ja tinha, o painel avisa a janela (`admin:sino-mudou`) e a lista
// relê. Este teste prova o lado do sino; o lado da lista esta em
// use-avisos-do-lojista.test.ts.
//
// Controles: a primeira leitura (0 -> N ao abrir o painel) nao avisa, porque a
// lista acabou de nascer e le por conta propria; e uma recontagem que NAO veio
// do tempo real (volta da internet, foco) e trouxe os mesmos numeros tambem nao
// avisa, senao cada recontagem releria a lista a toa.
//
// Pulso do tempo real com o MESMO numero avisa (13/11/2026): trocar uma
// pendencia por outra (o pedido A foi para entrega pelo celular e o B entrou
// antes da recontagem) deixa o sino em 1 e a lista velha, sem o B. Um pulso e'
// uma mudanca de verdade em pedidos/perguntas; a releitura continua agrupada na
// mesma janela de 1 s, entao uma rajada custa UMA releitura.
//
// Mesmo dublê do query builder de sino-do-painel-acende-quando-consulta-falha.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let PEDIDOS_PENDENTES = 0;
const handlersDoTempoReal = new Map<string, (payload?: unknown) => void>();

function criarContagemBuilder(tabela: string) {
  const builder: Record<string, unknown> = {};
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
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase — mesmo padrão dos vizinhos deste diretório.
  builder.then = (resolve: never, reject?: never) =>
    Promise.resolve({
      count:
        tabela === "marketplace_orders" && !ehRecebimento
          ? PEDIDOS_PENDENTES
          : 0,
      error: null,
    }).then(resolve, reject);
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
    channel: vi.fn((nome: string) => {
      const canal: Record<string, unknown> = {};
      canal.on = vi.fn(
        (_tipo: string, cfg: { table: string }, handler: () => void) => {
          handlersDoTempoReal.set(`${nome}#${cfg.table}`, handler);
          return canal;
        },
      );
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

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 3000, passoMs = 20 } = {},
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

/** Deixa passar mais que a janela de agrupamento (1 s) do sino. */
async function passarAJanelaDeAgrupamento() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1300));
  });
}

describe("AdminLayout — o sino avisa a lista quando o numero muda", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let avisos = 0;
  const contar = () => {
    avisos += 1;
  };

  beforeEach(async () => {
    PEDIDOS_PENDENTES = 0;
    avisos = 0;
    handlersDoTempoReal.clear();
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
    window.addEventListener("admin:sino-mudou", contar);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-notifications" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    // A primeira leitura chegou e os canais do tempo real foram assinados.
    await esperarAte(() =>
      handlersDoTempoReal.has("admin-layout-orders-badge#marketplace_orders"),
    );
    await act(async () => {
      await Promise.resolve();
    });
  });

  afterEach(() => {
    window.removeEventListener("admin:sino-mudou", contar);
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const pulsoDePedidos = () =>
    act(async () => {
      handlersDoTempoReal.get(
        "admin-layout-orders-badge#marketplace_orders",
      )?.();
    });

  it("a primeira leitura (abrir o painel) nao avisa: a lista acabou de nascer", async () => {
    expect(avisos).toBe(0);
  });

  it("chegou pedido (0 -> 2) com a tela aberta: avisa a lista UMA vez", async () => {
    PEDIDOS_PENDENTES = 2;

    await pulsoDePedidos();
    await esperarAte(() => avisos > 0);
    await passarAJanelaDeAgrupamento();

    expect(avisos).toBe(1);
  });

  it("trocou uma pendencia por outra (o numero NAO mudou): o pulso do tempo real avisa a lista", async () => {
    PEDIDOS_PENDENTES = 0;

    await pulsoDePedidos();
    await esperarAte(() => avisos > 0);
    await passarAJanelaDeAgrupamento();

    expect(avisos).toBe(1);
  });

  it.each(["questions", "answers"])(
    "pulso de %s com o mesmo numero tambem avisa a lista",
    async (tabela) => {
      await act(async () => {
        handlersDoTempoReal.get(`admin-layout-questions-badge#${tabela}`)?.();
      });
      await esperarAte(() => avisos > 0);
      await passarAJanelaDeAgrupamento();

      expect(avisos).toBe(1);
    },
  );

  it("rajada de pulsos sem mudar o numero: avisa a lista UMA vez", async () => {
    await pulsoDePedidos();
    await pulsoDePedidos();
    await pulsoDePedidos();
    await esperarAte(() => avisos > 0);
    await passarAJanelaDeAgrupamento();

    expect(avisos).toBe(1);
  });

  it("o pedido de releitura do pulso e' gasto: a recontagem seguinte, sem pulso, nao avisa de novo", async () => {
    await pulsoDePedidos();
    await esperarAte(() => avisos > 0);
    await passarAJanelaDeAgrupamento();
    expect(avisos).toBe(1);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await passarAJanelaDeAgrupamento();

    expect(avisos).toBe(1);
  });

  it("controle: recontagem que nao veio do tempo real (volta da internet) com o mesmo numero NAO avisa", async () => {
    PEDIDOS_PENDENTES = 0;

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await passarAJanelaDeAgrupamento();

    expect(avisos).toBe(0);
  });
});
