// @vitest-environment jsdom
//
// Defeito 3 (lote fix/caca-defeitos-lote-1): o sino do cabeçalho mobile
// (AdminLayout.tsx, bloco "Right: Notifications") pisca vermelho quando há
// pedido pendente OU pergunta sem resposta, mas o clique sempre levava para
// "admin-push" — uma tela que não lê pedido nem pergunta. A lojista via o
// alerta, clicava, e caía num lugar sem relação com o que a acendeu.
//
// Regra de destino escolhida: pedido pendente tem prioridade sobre pergunta
// pendente (os dois disparam o mesmo ponto vermelho, mas só um destino cabe
// no clique). Sem nenhum dos dois pendente, o sino continua levando para
// "admin-push" — não há alerta para seguir.
//
// Este teste mocka contagens de pedidos E perguntas pendentes ao mesmo
// tempo, clica no sino, e prova as duas pontas na mesma rodada: o destino é
// "admin-orders" (a regra de prioridade), e "admin-push" NUNCA é chamado —
// era o destino errado que a lojista caía antes da correção.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reatribuiveis: sem um caso com PEDIDOS = 0 e PERGUNTAS > 0, quebrar o ramo
// do meio (o destino de pergunta sozinha) passa despercebido -- nos cenarios
// testados ou ha pedido pendente, ou nao ha nada. Achado da revisao.
let PEDIDOS_PENDENTES = 3;
let PERGUNTAS_PENDENTES = 5;

function criarOrdersCountBuilder() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase — mesmo padrão de dashboard-escuta-a-tabela-certa e admin-layout-cracha-pedidos-pendentes.
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: PEDIDOS_PENDENTES, error: null }).then(
      resolve,
      reject,
    );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => criarOrdersCountBuilder()),
    rpc: vi.fn(() =>
      Promise.resolve({
        data: { total_count: PERGUNTAS_PENDENTES },
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Espera até `condicao()` ficar verdadeira — mesmo helper usado em
 * admin-layout-cracha-pedidos-pendentes.test.tsx. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
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

describe("AdminLayout — o sino leva para onde o alerta aponta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    PEDIDOS_PENDENTES = 3;
    PERGUNTAS_PENDENTES = 5;
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
  });

  it("com pedido E pergunta pendentes, o clique leva para Pedidos — nunca para Push", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    const onNavigate = vi.fn();

    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={onNavigate}>
          <div />
        </AdminLayout>,
      );
    });

    const botaoPedidos = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Pedidos"),
    );
    expect(botaoPedidos).toBeTruthy();
    // Espera as duas contagens chegarem — sinal de que o efeito de busca
    // inicial já rodou e o sino já reflete pedido pendente.
    await esperarAte(
      () =>
        botaoPedidos!.textContent?.includes(String(PEDIDOS_PENDENTES)) ?? false,
    );

    const sino = hospedeiro.querySelector("button.size-7");
    expect(sino).toBeTruthy();

    await act(async () => {
      sino!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(onNavigate).toHaveBeenCalledWith("admin-orders");
    // Controle negativo: o destino antigo (a tela de push, que não lê pedido
    // nem pergunta) não pode ser chamado enquanto há alerta pendente.
    expect(onNavigate).not.toHaveBeenCalledWith("admin-push");
  });

  // O ramo do MEIO: so pergunta pendente. Sem este caso, trocar o ternario por
  // `pedidos > 0 ? "admin-orders" : "admin-push"` -- apagando o destino de
  // pergunta sozinha -- passa nos outros casos, porque neles ou ha pedido
  // pendente, ou nao ha nada. A lojista veria o sino aceso por uma pergunta e
  // cairia na tela de push de novo.
  it("com SO pergunta pendente, o clique leva para Perguntas", async () => {
    PEDIDOS_PENDENTES = 0;
    PERGUNTAS_PENDENTES = 4;

    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    const onNavigate = vi.fn();

    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={onNavigate}>
          <div />
        </AdminLayout>,
      );
    });

    const sino = hospedeiro.querySelector("button.size-7");
    expect(sino).toBeTruthy();

    // Espera a contagem de perguntas chegar -- sem isso o clique aconteceria
    // antes de o efeito de busca inicial ter rodado, e o caso mediria o
    // estado vazio em vez do que ele diz medir.
    await esperarAte(() => {
      const marcador = hospedeiro.querySelector("button.size-7 span");
      return marcador !== null;
    });

    await act(async () => {
      sino!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(onNavigate).toHaveBeenCalledWith("admin-qa");
    expect(onNavigate).not.toHaveBeenCalledWith("admin-push");
  });
});
