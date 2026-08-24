// @vitest-environment jsdom
//
// O sino do cabeçalho do painel (AdminLayout.tsx, bloco "Right:
// Notifications") passa a ter UM destino só: a tela de Notificações do
// lojista, onde os avisos ficam listados. O sino é a porta da tela; não é
// mais um atalho que adivinha qual alerta o lojista quis ver.
//
// ATENCAO: este arquivo SUBSTITUI `sino-do-painel-leva-onde-o-alerta-aponta
// .test.tsx`, que foi apagado de proposito. Aquele teste prendia o
// comportamento ANTIGO — a escada `pedido > pergunta > push`, em que o
// clique escolhia entre tres telas conforme o que estivesse pendente. A
// escada existia porque nao havia tela de notificacoes: o sino tinha de
// chutar um destino. Agora ha, e chutar virou defeito. O teste antigo nao
// estava errado nem incomodo — ele descrevia com precisao um comportamento
// que deixou de ser o desejado, e por isso saiu junto com ele.
//
// Os dois primeiros casos sao o par que prova que a escada foi REMOVIDA, e
// nao rearrumada: com pedido pendente e com absolutamente nada pendente, o
// destino e o MESMO. Qualquer escada que sobreviva, em qualquer ordem,
// derruba um dos dois.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reatribuiveis por caso: cada contagem alimenta um degrau da escada antiga,
// e e variando as tres que se prova que nenhum degrau sobrou.
let PEDIDOS_PENDENTES = 0;
let PERGUNTAS_PENDENTES = 0;
let AVALIACOES_SEM_RESPOSTA = 0;

/** Duble do query builder de contagem do Supabase (`head: true`). */
function criarContagemBuilder(contagem: number) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase — mesmo padrão de dashboard-escuta-a-tabela-certa e admin-layout-cracha-pedidos-pendentes.
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: contagem, error: null }).then(resolve, reject);
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    // A contagem depende da TABELA: sem separar, o caso da avaliacao mediria
    // a contagem de pedidos e passaria com o codigo errado.
    from: vi.fn((tabela: string) =>
      criarContagemBuilder(
        tabela === "reviews" ? AVALIACOES_SEM_RESPOSTA : PEDIDOS_PENDENTES,
      ),
    ),
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

describe("AdminLayout — o sino abre as Notificações do lojista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    PEDIDOS_PENDENTES = 0;
    PERGUNTAS_PENDENTES = 0;
    AVALIACOES_SEM_RESPOSTA = 0;
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

  /** Monta o painel e devolve o `onNavigate` espiao e o botao do sino. */
  async function montarPainel() {
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
    return { onNavigate, sino: sino as HTMLButtonElement };
  }

  /** Espera a busca inicial das contagens ter respondido. */
  async function esperarContagensChegarem() {
    const { supabase } = await import("@/lib/supabase");
    await esperarAte(() => (supabase.rpc as any).mock.calls.length > 0);
    // Um flush a mais: a RPC ter sido CHAMADA nao e a resposta ter virado
    // estado. Sem ele o clique mediria a tela antes de o cracha existir.
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("com pedido pendente, o sino abre as Notificações — não a lista de Pedidos", async () => {
    PEDIDOS_PENDENTES = 3;
    PERGUNTAS_PENDENTES = 5;

    const { onNavigate, sino } = await montarPainel();

    // Espera a contagem aparecer no cracha da nav: e a prova de que a busca
    // inicial rodou e a escada antiga TERIA escolhido "admin-orders" aqui.
    const botaoPedidos = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Pedidos"),
    );
    expect(botaoPedidos).toBeTruthy();
    await esperarAte(
      () =>
        botaoPedidos?.textContent?.includes(String(PEDIDOS_PENDENTES)) ?? false,
    );

    await act(async () => {
      sino.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(onNavigate).toHaveBeenCalledWith("admin-notifications");
  });

  it("sem nada pendente, o sino abre O MESMO lugar — a escada não foi rearrumada", async () => {
    const { onNavigate, sino } = await montarPainel();
    await esperarContagensChegarem();

    await act(async () => {
      sino.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    // Este caso e o de cima sao um par: com alerta e sem alerta, o MESMO
    // destino. Uma escada rearrumada passaria em um deles; nenhuma passa nos
    // dois.
    expect(onNavigate).toHaveBeenCalledWith("admin-notifications");
  });

  it("nenhum destino antigo do sino é chamado — nem Push, nem Pedidos, nem Perguntas", async () => {
    PEDIDOS_PENDENTES = 2;
    PERGUNTAS_PENDENTES = 7;
    AVALIACOES_SEM_RESPOSTA = 1;

    const { onNavigate, sino } = await montarPainel();
    await esperarContagensChegarem();

    await act(async () => {
      sino.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    // Controle negativo com TODAS as contagens acesas: qualquer degrau da
    // escada que tenha sobrevivido acende um destes tres.
    expect(onNavigate).not.toHaveBeenCalledWith("admin-push");
    expect(onNavigate).not.toHaveBeenCalledWith("admin-orders");
    expect(onNavigate).not.toHaveBeenCalledWith("admin-qa");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("só com avaliação sem resposta, a bolinha vermelha do sino acende", async () => {
    AVALIACOES_SEM_RESPOSTA = 4;

    const { sino } = await montarPainel();

    // Pedido e pergunta em ZERO de proposito: se a bolinha continuasse
    // olhando so os dois, este caso ficaria apagado e o lojista teria uma
    // avaliacao esperando com o sino sem alerta nenhum.
    await esperarAte(() => sino.querySelector("span") !== null);
    expect(sino.querySelector("span")).toBeTruthy();
  });
  it("no computador, a barra lateral tem porta para as Notificações", async () => {
    const { onNavigate } = await montarPainel();

    // A `<aside>` e a barra lateral do computador: ela nasce com
    // `hidden ... lg:flex`, ou seja, so existe a partir de 1024px. O sino
    // mora no cabecalho `lg:hidden`, que e o OPOSTO — entao uma porta que so
    // exista no sino deixa esta tela inalcancavel no computador. Foi
    // exatamente esse o defeito que a revisao de contexto limpo pegou: zero
    // portas visiveis acima de 1024px.
    const barraLateral = hospedeiro.querySelector("aside");
    expect(barraLateral).toBeTruthy();

    const porta = Array.from(
      (barraLateral as HTMLElement).querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Notificações"));
    expect(porta).toBeTruthy();

    await act(async () => {
      (porta as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(onNavigate).toHaveBeenCalledWith("admin-notifications");
  });

  it("só com pergunta sem resposta, a bolinha vermelha do sino acende", async () => {
    PERGUNTAS_PENDENTES = 6;

    const { sino } = await montarPainel();

    // Este caso veio do teste apagado e voltou de proposito: sem ele, apagar
    // `pendingQuestionsCount > 0` da condicao da bolinha passa na suite
    // inteira, e o lojista fica com pergunta esperando e o sino apagado.
    await esperarAte(() => sino.querySelector("span") !== null);
    expect(sino.querySelector("span")).toBeTruthy();
  });

  it("com tudo zerado, a bolinha do sino fica APAGADA", async () => {
    const { sino } = await montarPainel();
    await esperarContagensChegarem();

    // Controle negativo da bolinha: os outros casos so provam que ela ACENDE.
    // Uma bolinha acesa sem condicao nenhuma passaria em todos eles.
    expect(sino.querySelector("span")).toBeNull();
  });
});
