// @vitest-environment jsdom
//
// Defeito (caçador, r420): o sino/bolinha de pedidos novos do painel
// (AdminLayout.tsx) podia ficar apagado depois de voltar ao app. A aba volta,
// a leitura da contagem responde "zero" e começa ANTES de a assinatura do
// tempo real estar pronta (a conexão ainda está abrindo); nesse intervalo
// outro aparelho conclui um pedido; quando a assinatura enfim fica
// `SUBSCRIBED`, a PRIMEIRA confirmação não pedia nova leitura (só a
// reconexão depois de uma queda pedia). O pedido ocorrido entre a leitura e
// a confirmação não chegava nem pela consulta nem pelo tempo real.
//
// O que este teste prova:
// 1. Pedido entra entre a leitura e o primeiro SUBSCRIBED: ao confirmar, a
//    contagem sobe de 0 para 1.
// 2. A releitura não pisca o sino: enquanto ela não responde, a contagem
//    anterior continua na tela (nunca passa por zero).
// 3. Uma releitura só: os dois canais confirmando, ou a mesma confirmação
//    repetida sem queda, não dobram a leitura; e uma leitura que o tempo real
//    pede depois de a assinatura estar pronta continua sendo UMA.
// 4. Resposta antiga que chega depois da nova não a sobrescreve.
// 5. Aba escondida não bate na rede: confirmação de canal já fechado não lê.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOME_CANAL_PEDIDOS = "admin-layout-orders-badge";
const NOME_CANAL_PERGUNTAS = "admin-layout-questions-badge";

// O que o banco tem AGORA: a leitura que sair devolve este número.
let pedidosNoBanco = 0;
// Leituras de pedidos que o teste quer segurar no ar: a PRÓXIMA leitura
// consome o primeiro item e só responde quando o teste resolve.
let leiturasPresas: Array<Promise<number>> = [];
// Quantas vezes a consulta de pedidos para preparar saiu (uma por rodada).
let leiturasDePedidos = 0;
const statusPorCanal = new Map<string, (status: string) => void>();
const handlersPorCanal = new Map<string, () => void>();

function builderDePedidos() {
  let paraPreparar = false;
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => {
    paraPreparar = true;
    return builder;
  });
  builder.or = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) => {
    if (!paraPreparar) {
      return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
    }
    leiturasDePedidos += 1;
    // O número é lido AGORA (o banco no instante da consulta), não quando a
    // resposta é entregue.
    const presa = leiturasPresas.shift();
    const contagem = presa ?? Promise.resolve(pedidosNoBanco);
    return contagem
      .then((count) => ({ count, error: null }))
      .then(resolve, reject);
  };
  return builder;
}

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
    from: vi.fn((tabela: string) =>
      tabela === "marketplace_orders"
        ? builderDePedidos()
        : builderSemContador(),
    ),
    rpc: vi.fn((nome: string) =>
      Promise.resolve({
        data:
          nome === "admin_devolucoes_listar"
            ? { total: 0, itens: [], contagem: { solicitada: 0 } }
            : { total_count: 0 },
        error: null,
      }),
    ),
    channel: vi.fn((nome: string) => {
      const canal: any = {};
      canal.on = vi.fn((_tipo: string, cfg: any, handler: () => void) => {
        handlersPorCanal.set(`${nome}#${cfg.table}`, handler);
        return canal;
      });
      canal.subscribe = vi.fn((status: (status: string) => void) => {
        statusPorCanal.set(nome, status);
        return canal;
      });
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

function pausa(ms: number) {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/**
 * Espera uma condição de TELA: cada passo é um `act` próprio, porque dentro de
 * um `act` só (como em `esperarAte`) a atualização de estado fica na fila e
 * não pinta até o `act` terminar.
 */
async function esperarNaTela(condicao: () => boolean, timeoutMs = 5000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`esperarNaTela: sem resultado em ${timeoutMs}ms`);
    }
    await pausa(25);
  }
}

/** Uma leitura que só responde quando o teste mandar. */
function leituraManual() {
  let responder: (count: number) => void = () => {};
  const promessa = new Promise<number>((resolve) => {
    responder = resolve;
  });
  return { promessa, responder };
}

let visibilidade: "visible" | "hidden" = "visible";

function mudarVisibilidade(novo: "visible" | "hidden") {
  visibilidade = novo;
  return act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("AdminLayout — pedido que entra entre a leitura e a assinatura", () => {
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
    pedidosNoBanco = 0;
    leiturasPresas = [];
    leiturasDePedidos = 0;
    statusPorCanal.clear();
    handlersPorCanal.clear();
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
    await esperarAte(() => leiturasDePedidos >= 1);
    // Deixa a primeira leitura (se não estiver presa) terminar e pintar.
    await pausa(50);
  }

  /** Nomes acessíveis da aba de Pedidos (celular e computador). */
  function rotulosDePedidos() {
    return Array.from(hospedeiro.querySelectorAll("button"))
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter((rotulo) => rotulo.startsWith("Pedidos"));
  }

  function confirmarOsDoisCanais() {
    return act(async () => {
      statusPorCanal.get(NOME_CANAL_PEDIDOS)?.("SUBSCRIBED");
      statusPorCanal.get(NOME_CANAL_PERGUNTAS)?.("SUBSCRIBED");
    });
  }

  it("(a) pedido entra entre a leitura e o SUBSCRIBED: ao confirmar, a bolinha sobe para 1", async () => {
    await montar();
    // A leitura inicial devolveu zero: bolinha apagada.
    expect(rotulosDePedidos().every((r) => r === "Pedidos")).toBe(true);

    // Outro aparelho conclui um pedido ANTES de a assinatura confirmar: o
    // tempo real ainda não existia, então nenhum pulso chega.
    pedidosNoBanco = 1;
    expect(handlersPorCanal.size).toBeGreaterThan(0);

    await confirmarOsDoisCanais();

    await esperarNaTela(() =>
      rotulosDePedidos().some((r) => r.includes("1 para preparar")),
    );
  });

  it("(a2) a releitura não pisca o sino: enquanto ela não responde, a contagem anterior fica", async () => {
    pedidosNoBanco = 2;
    await montar();
    await esperarNaTela(() =>
      rotulosDePedidos().some((r) => r.includes("2 para preparar")),
    );

    const releitura = leituraManual();
    leiturasPresas.push(releitura.promessa);
    pedidosNoBanco = 3;
    await confirmarOsDoisCanais();
    await esperarAte(() => leiturasDePedidos >= 2);

    // Releitura no ar e ainda sem resposta: nada de zero na tela.
    expect(rotulosDePedidos().some((r) => r.includes("2 para preparar"))).toBe(
      true,
    );

    await act(async () => {
      releitura.responder(3);
    });
    await esperarNaTela(() =>
      rotulosDePedidos().some((r) => r.includes("3 para preparar")),
    );
  });

  it("(b) os dois canais confirmando e a confirmação repetida sem queda fazem UMA releitura", async () => {
    await montar();
    expect(leiturasDePedidos).toBe(1);

    await confirmarOsDoisCanais();
    await esperarAte(() => leiturasDePedidos >= 2);
    await pausa(1300);
    expect(leiturasDePedidos).toBe(2);

    // Mesma confirmação de novo, sem queda no meio: nada de novo.
    await confirmarOsDoisCanais();
    await pausa(1300);
    expect(leiturasDePedidos).toBe(2);
  });

  it("(b2) assinatura já pronta: um pulso do tempo real depois dela lê UMA vez, sem somar leitura de confirmação", async () => {
    await montar();
    await confirmarOsDoisCanais();
    await esperarAte(() => leiturasDePedidos >= 2);
    await pausa(1300);
    const depoisDaConfirmacao = leiturasDePedidos;

    await act(async () => {
      handlersPorCanal.get(`${NOME_CANAL_PEDIDOS}#marketplace_orders`)?.();
    });
    await esperarAte(() => leiturasDePedidos > depoisDaConfirmacao);
    await pausa(1300);
    expect(leiturasDePedidos).toBe(depoisDaConfirmacao + 1);
  });

  it("(c) resposta antiga que chega depois da nova não sobrescreve a contagem", async () => {
    // A leitura da montagem fica pendurada na rede.
    const antiga = leituraManual();
    leiturasPresas.push(antiga.promessa);
    await montar();

    pedidosNoBanco = 1;
    await confirmarOsDoisCanais();
    await esperarNaTela(() =>
      rotulosDePedidos().some((r) => r.includes("1 para preparar")),
    );

    // Só agora a resposta velha ("zero", de antes do pedido) chega.
    await act(async () => {
      antiga.responder(0);
    });
    await pausa(100);

    expect(rotulosDePedidos().some((r) => r.includes("1 para preparar"))).toBe(
      true,
    );
  });

  it("(e) aba escondida: confirmação de canal fechado não bate na rede", async () => {
    await montar();
    const status = statusPorCanal.get(NOME_CANAL_PEDIDOS);
    expect(status).toBeTypeOf("function");

    await mudarVisibilidade("hidden");
    const antes = leiturasDePedidos;
    await act(async () => {
      status?.("SUBSCRIBED");
    });
    await pausa(1300);

    expect(leiturasDePedidos).toBe(antes);
  });
});
