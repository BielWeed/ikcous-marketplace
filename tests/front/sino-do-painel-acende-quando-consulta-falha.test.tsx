// @vitest-environment jsdom
//
// Defeito medido em 25/08/2026: a bolinha vermelha do sino (AdminLayout.tsx)
// so' considerava uma consulta quando ela respondia SEM erro
// (`if (!ordersErr && ...)`). Se a consulta de pedidos, perguntas ou
// avaliacoes falhasse, a contagem ficava em 0 e o sino apagava — a mesma
// tela que "esta tudo em dia" mostra quando nao ha pendencia nenhuma. Falha
// de rede e "nada pendente" viravam a MESMA tela, e o lojista nao tinha
// motivo nenhum para abrir as Notificacoes e descobrir o pedido esperando.
//
// A regra que este teste prova: desconhecido nunca e' sucesso. Quando uma
// consulta falha, o sino tem que acender — nao porque ha pendencia
// confirmada, mas porque o app nao sabe se ha. Os tres casos abaixo sao os
// tres estados possiveis, e o terceiro (controle negativo) e' o que prova
// que a correcao nao acende o sino sempre: sem pendencia e sem falha, ele
// continua apagado.
//
// Ressalvas da revisão de contexto limpo de 25/08/2026 (o conserto acima já
// PASSOU e não é reaberto aqui):
// - Ressalva 1: a bolinha acesa por dúvida não apagava sozinha numa aba em
//   primeiro plano de loja parada — agora há retentativa com recuo
//   exponencial, só quando a última rodada falhou.
// - Ressalva 2: o dublê só ligava erro na consulta de PEDIDOS. Quatro
//   mutantes construídos contra o arquivo anterior mostraram que apagar a
//   marca de falha em perguntas (qErr), avaliações (reviewsErr) ou no
//   `catch` sobrevivia — só o de pedidos (ordersErr) era pego.
// - Ressalva 3: duas rodadas de `fetchInitialCounts` em voo podiam terminar
//   fora de ordem, e a mais velha vencia — inclusive escrevendo o veredito
//   velho por cima do novo.
//
// Mesmo padrao de duble do query builder thenable do Supabase usado em
// sino-do-painel-leva-as-notificacoes.test.tsx e
// admin-layout-cracha-pedidos-pendentes.test.tsx — `@/lib/supabase` e' mocado
// porque AdminLayout.tsx le VITE_SUPABASE_URL/ANON_KEY no import e explode
// sem o mock.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let PEDIDOS_PENDENTES = 0;
let PERGUNTAS_PENDENTES = 0;
let AVALIACOES_SEM_RESPOSTA = 0;
// Liga o erro simulado por consulta — uma flag por fonte, porque a revisão
// mediu que ligar só a de pedidos deixava os outros três pontos sem prova.
let ERRO_NA_CONSULTA_DE_PEDIDOS = false;
let ERRO_NA_CONSULTA_DE_PERGUNTAS = false;
let ERRO_NA_CONSULTA_DE_AVALIACOES = false;
// Exceção LANÇADA (caminho do `catch`), e não `error` devolvido no objeto —
// são caminhos diferentes dentro de `fetchInitialCounts`.
let EXCECAO_NA_CONSULTA_DE_PEDIDOS = false;
let EXCECAO_NA_CONSULTA_DE_AVALIACOES = false;
let EXCECAO_NA_CONSULTA_DE_PERGUNTAS = false;
// Controle de UMA leitura de `marketplace_orders`, usado só pelo teste de
// corrida (ressalva 3): quando setado, a PRÓXIMA leitura dessa tabela fica
// pendurada até o teste resolver manualmente — é consumido (voltando a
// `null`) assim que uma leitura o usa, então só a rodada que o teste quer
// atrasar é afetada; as demais seguem o caminho rápido padrão.
let ORDERS_DEFERRED: {
  promise: Promise<{ count: number | null; error: Error | null }>;
  resolve: (valor: { count: number | null; error: Error | null }) => void;
} | null = null;

function criarDeferred<T>() {
  let resolver!: (valor: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolve: resolver };
}

/** Dublê do query builder de contagem do Supabase (`head: true`), com erro e
 * exceção simuláveis por tabela. */
function criarContagemBuilder(
  tabela: string,
  contagemPadrao: number,
  erroPadrao: boolean,
  excecaoPadrao = false,
) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase — mesmo padrão dos vizinhos deste diretório.
  builder.then = (resolve: any, reject?: any) => {
    if (tabela === "marketplace_orders" && ORDERS_DEFERRED) {
      const deferido = ORDERS_DEFERRED;
      ORDERS_DEFERRED = null;
      return deferido.promise.then(resolve, reject);
    }
    if (excecaoPadrao) {
      return Promise.reject(new Error("excecao simulada de rede")).then(
        resolve,
        reject,
      );
    }
    return Promise.resolve(
      erroPadrao
        ? { count: null, error: new Error("falha simulada de rede") }
        : { count: contagemPadrao, error: null },
    ).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      if (tabela === "marketplace_orders") {
        return criarContagemBuilder(
          tabela,
          PEDIDOS_PENDENTES,
          ERRO_NA_CONSULTA_DE_PEDIDOS,
          EXCECAO_NA_CONSULTA_DE_PEDIDOS,
        );
      }
      if (tabela === "reviews") {
        return criarContagemBuilder(
          tabela,
          AVALIACOES_SEM_RESPOSTA,
          ERRO_NA_CONSULTA_DE_AVALIACOES,
          EXCECAO_NA_CONSULTA_DE_AVALIACOES,
        );
      }
      return criarContagemBuilder(tabela, 0, false, false);
    }),
    rpc: vi.fn(() => {
      if (EXCECAO_NA_CONSULTA_DE_PERGUNTAS) {
        return Promise.reject(new Error("excecao simulada de rede"));
      }
      return Promise.resolve({
        data: ERRO_NA_CONSULTA_DE_PERGUNTAS
          ? null
          : { total_count: PERGUNTAS_PENDENTES },
        error: ERRO_NA_CONSULTA_DE_PERGUNTAS
          ? new Error("falha simulada de rede")
          : null,
      });
    }),
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
 * sino-do-painel-leva-as-notificacoes.test.tsx. */
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

/** Monta o painel e devolve o botão do sino (cabeçalho mobile). */
async function montarPainel(raiz: Root, hospedeiro: HTMLDivElement) {
  const { AdminLayout } = await import("@/components/layouts/AdminLayout");

  await act(async () => {
    raiz.render(
      <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
        <div />
      </AdminLayout>,
    );
  });

  const sino = hospedeiro.querySelector("button.size-7");
  expect(sino).toBeTruthy();
  return sino as HTMLButtonElement;
}

/** Espera a busca inicial das contagens ter respondido. */
async function esperarContagensChegarem() {
  const { supabase } = await import("@/lib/supabase");
  await esperarAte(() => (supabase.rpc as any).mock.calls.length > 0);
  // Um flush a mais: a RPC ter sido CHAMADA nao e a resposta ter virado
  // estado (setState).
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AdminLayout — o sino acende quando uma consulta falha, não quando apaga", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    PEDIDOS_PENDENTES = 0;
    PERGUNTAS_PENDENTES = 0;
    AVALIACOES_SEM_RESPOSTA = 0;
    ERRO_NA_CONSULTA_DE_PEDIDOS = false;
    ERRO_NA_CONSULTA_DE_PERGUNTAS = false;
    ERRO_NA_CONSULTA_DE_AVALIACOES = false;
    EXCECAO_NA_CONSULTA_DE_PEDIDOS = false;
    EXCECAO_NA_CONSULTA_DE_AVALIACOES = false;
    EXCECAO_NA_CONSULTA_DE_PERGUNTAS = false;
    ORDERS_DEFERRED = null;
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

  it("a consulta de pedidos falha, e nada mais está pendente — o sino ACENDE", async () => {
    ERRO_NA_CONSULTA_DE_PEDIDOS = true;

    const sino = await montarPainel(raiz, hospedeiro);
    await esperarContagensChegarem();

    // Nenhuma pendência real existe (tudo em 0) — se o sino acender, é por
    // causa da falha, não de uma contagem positiva. É exatamente esse o
    // defeito: hoje a falha faz a contagem ficar em 0 e o sino apaga.
    expect(sino.querySelector("span")).toBeTruthy();
  });

  it("há pendência real (pedido pendente), sem falha nenhuma — o sino acende, como já acendia", async () => {
    PEDIDOS_PENDENTES = 3;

    const sino = await montarPainel(raiz, hospedeiro);
    await esperarContagensChegarem();

    expect(sino.querySelector("span")).toBeTruthy();
  });

  it("controle negativo: nada pendente e nenhuma falha — o sino NÃO acende", async () => {
    const sino = await montarPainel(raiz, hospedeiro);
    await esperarContagensChegarem();

    // Sem este caso, uma correção que acendesse o sino sempre (para
    // qualquer coisa) passaria nos dois testes de cima também.
    expect(sino.querySelector("span")).toBeNull();
  });

  // Ressalva 2 da revisão de 25/08/2026: quatro mutantes construídos contra
  // o arquivo anterior (apagar a marca de falha em `ordersErr`, `qErr`,
  // `reviewsErr` e no `catch`) mostraram que só o de `ordersErr` era pego —
  // os outros três sobreviviam porque o dublê só sabia simular falha na
  // consulta de pedidos. Estes três casos fecham os pontos que sobreviviam.
  it("a consulta de perguntas falha (qErr), e nada mais está pendente — o sino ACENDE", async () => {
    ERRO_NA_CONSULTA_DE_PERGUNTAS = true;

    const sino = await montarPainel(raiz, hospedeiro);
    await esperarContagensChegarem();

    expect(sino.querySelector("span")).toBeTruthy();
  });

  it("a consulta de avaliações falha (reviewsErr), e nada mais está pendente — o sino ACENDE", async () => {
    ERRO_NA_CONSULTA_DE_AVALIACOES = true;

    const sino = await montarPainel(raiz, hospedeiro);
    await esperarContagensChegarem();

    expect(sino.querySelector("span")).toBeTruthy();
  });

  it("uma consulta lança exceção em vez de devolver erro (caminho do catch) — o sino ACENDE", async () => {
    EXCECAO_NA_CONSULTA_DE_AVALIACOES = true;

    const sino = await montarPainel(raiz, hospedeiro);
    await esperarContagensChegarem();

    expect(sino.querySelector("span")).toBeTruthy();
  });
});

// Ressalva 1 da revisão de 25/08/2026: a bolinha acesa por DÚVIDA
// (`naoConseguiuConferirAvisos`) não apaga sozinha numa aba em primeiro
// plano de uma loja sem movimento — nenhum dos três gatilhos existentes
// (visibilitychange, realtime, broadcast) dispara ali. A correção agenda
// uma retentativa (recuo exponencial: 4s, 8s, 16s; teto de 3 tentativas) só
// quando a ÚLTIMA rodada falhou. Os dois testes provam as duas direções.
describe("AdminLayout — retentativa quando a rodada anterior falhou (ressalva 1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    PEDIDOS_PENDENTES = 0;
    PERGUNTAS_PENDENTES = 0;
    AVALIACOES_SEM_RESPOSTA = 0;
    ERRO_NA_CONSULTA_DE_PEDIDOS = false;
    ERRO_NA_CONSULTA_DE_PERGUNTAS = false;
    ERRO_NA_CONSULTA_DE_AVALIACOES = false;
    EXCECAO_NA_CONSULTA_DE_PEDIDOS = false;
    EXCECAO_NA_CONSULTA_DE_AVALIACOES = false;
    EXCECAO_NA_CONSULTA_DE_PERGUNTAS = false;
    ORDERS_DEFERRED = null;
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

  it("a rodada falha — uma retentativa dispara sozinha depois do recuo", async () => {
    ERRO_NA_CONSULTA_DE_PEDIDOS = true;

    await montarPainel(raiz, hospedeiro);
    const { supabase } = await import("@/lib/supabase");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const chamadasIniciais = (supabase.rpc as any).mock.calls.length;
    expect(chamadasIniciais).toBeGreaterThan(0);

    // Recuo da primeira retentativa: 4000ms. Passa um pouco além para não
    // depender da borda exata do agendamento.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });

    expect((supabase.rpc as any).mock.calls.length).toBeGreaterThan(
      chamadasIniciais,
    );
  });

  it("a rodada dá certo — nenhuma retentativa é agendada", async () => {
    await montarPainel(raiz, hospedeiro);
    const { supabase } = await import("@/lib/supabase");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const chamadasIniciais = (supabase.rpc as any).mock.calls.length;
    expect(chamadasIniciais).toBeGreaterThan(0);

    // Bem além do teto das três retentativas (4s + 8s + 16s = 28s) — se
    // alguma tivesse sido agendada por engano, já teria disparado aqui.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect((supabase.rpc as any).mock.calls.length).toBe(chamadasIniciais);
  });
});

// Ressalva 3 da revisão de 25/08/2026: `fetchInitialCounts` é disparada de
// quatro lugares (agora cinco, com a retentativa da ressalva 1) e pode ter
// duas rodadas em voo. Sem um número de rodada (mesmo padrão de
// `useAvisosDoLojista.ts:152-158`), quem termina por último vence —
// inclusive escrevendo o veredito VELHO por cima do novo. Este teste força
// exatamente essa corrida: a rodada 1 (montagem) fica pendurada numa
// consulta lenta que vai falhar; a rodada 2 (mensagem de BroadcastChannel —
// o caminho da aba secundária, já que `useLeaderElection` está mocado para
// `isLeader: false`) responde rápido e limpa a bolinha; só depois disso a
// rodada 1 termina.
describe("AdminLayout — rodada antiga não sobrescreve rodada nova (ressalva 3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let bcListeners: Array<(evento: { data?: { type?: string } }) => void>;

  beforeEach(() => {
    PEDIDOS_PENDENTES = 0;
    PERGUNTAS_PENDENTES = 0;
    AVALIACOES_SEM_RESPOSTA = 0;
    ERRO_NA_CONSULTA_DE_PEDIDOS = false;
    ERRO_NA_CONSULTA_DE_PERGUNTAS = false;
    ERRO_NA_CONSULTA_DE_AVALIACOES = false;
    EXCECAO_NA_CONSULTA_DE_PEDIDOS = false;
    EXCECAO_NA_CONSULTA_DE_AVALIACOES = false;
    EXCECAO_NA_CONSULTA_DE_PERGUNTAS = false;
    ORDERS_DEFERRED = null;
    bcListeners = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener(
          _tipo: string,
          escuta: (evento: { data?: { type?: string } }) => void,
        ) {
          bcListeners.push(escuta);
        }
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

  it("rodada 1 lenta (vai falhar) termina depois da rodada 2 (deu certo) — a bolinha continua apagada", async () => {
    // Rodada 1 (a montagem) fica pendurada aqui — ninguém responde até o
    // teste mandar.
    const deferidoDaRodada1 = criarDeferred<{
      count: number | null;
      error: Error | null;
    }>();
    ORDERS_DEFERRED = deferidoDaRodada1;

    const sino = await montarPainel(raiz, hospedeiro);

    // Rodada 2: mensagem de BroadcastChannel, a mesma que uma aba líder
    // manda quando algo muda. As três consultas dela respondem rápido (o
    // dublê padrão, sem falha) porque `ORDERS_DEFERRED` já foi consumido
    // pela rodada 1 e está `null`.
    //
    // C4 (laudo 0109): a mensagem da aba secundária não dispara a
    // conferência na hora — cai na coalescência de badges (janela de
    // 1s). A prova da corrida continua a mesma: a rodada 2 inteira
    // acontece AQUI, e a rodada 1 só termina depois.
    expect(bcListeners.length).toBeGreaterThan(0);
    await act(async () => {
      for (const escuta of bcListeners) {
        escuta({ data: { type: "badge_update" } });
      }
    });

    // Atravessa a janela de coalescência (1s) e espera a rodada 2
    // COMPLETAR — é ela que produz o veredito "deu certo".
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // A rodada 2 terminou bem: nada pendente, nenhuma falha — a bolinha
    // apaga.
    expect(sino.querySelector("span")).toBeNull();

    // Agora a rodada 1 (velha) termina, e termina MAL — pedidos com erro.
    await act(async () => {
      deferidoDaRodada1.resolve({
        count: null,
        error: new Error("falha simulada de rede, tardia"),
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Sem o número de rodada, o veredito velho (falhou) sobrescreveria o
    // novo (deu certo) e a bolinha acenderia sozinha. Com o guard, a
    // rodada 1 se reconhece superada e não mexe em estado nenhum.
    expect(sino.querySelector("span")).toBeNull();
  }, 10000);
});
