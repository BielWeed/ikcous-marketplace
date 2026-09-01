// @vitest-environment jsdom
//
// R-2 (laudo varredura profunda 01/09): o conjunto `questionIdsDoProdutoRef`
// — que filtra o canal de `answers` (C4) — era gravado FORA da guarda
// `latestProductIdRef.current === productId` que governa o `setQuestions`.
// Numa corrida de duas cargas (A lenta, B rápida), a carga velha A concluía
// DEPOIS da B e sobrescrevia o conjunto com os ids DELA enquanto a tela
// mostrava as perguntas de B: resposta a pergunta de B parava de acordar a
// página (o evento ficava fora do conjunto de A) e resposta a pergunta de A
// acordava a tela errada.
//
// O conserto: a gravação do conjunto entra na MESMA guarda do
// `setQuestions` (conjunto == o que está na tela), e o catch reanula o
// conjunto quando a carga que falhou ainda é a governante (conjunto nulo =
// filtro passa tudo — o comportamento conservador de "ainda não carregou").
//
// O teste exercita o hook REAL com o canal de realtime dublê e consultas de
// `questions` com resolução CONTROLADA (deferred), para ordernar o fim das
// duas cargas à mão. O mesmo padrão de
// `answers-so-acordam-a-pagina-do-produto.test.tsx`.
import { act, useEffect, useRef } from "react";
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

// ── a fila de consultas de `questions`, com resolução controlada ─────────
// Cada chamada de rede do hook consome o próximo item da fila. O teste
// decide QUANDO cada consulta resolve e com o quê — é o que permite montar
// a corrida "A termina depois de B".
type ResultadoDaConsulta = { dados?: any[]; erro?: any };
function criarConsultaPendente() {
  let resolver!: (r: ResultadoDaConsulta) => void;
  const promessa = new Promise<ResultadoDaConsulta>((r) => {
    resolver = r;
  });
  return {
    promessa,
    resolverCom(dados: any[]) {
      resolver({ dados });
    },
    rejeitarCom(erro: any) {
      resolver({ erro });
    },
  };
}

let filaDeConsultas: Array<{
  consulta: ReturnType<typeof criarConsultaPendente>;
}> = [];

// ── observadores ──────────────────────────────────────────────────────────
// `acordou` conta quantas respostas passaram pela guarda e dispararam o
// refetch (o onChange da assinatura).
let acordou = 0;

let handlersDoCanal: Map<string, (payload: any) => void> = new Map();

function builderSimples(dados: any) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.abortSignal = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: dados, error: null }).then(resolve, reject);
  return builder;
}

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "cliente-1", email: "cliente@teste.com" },
    profile: null,
    isAdmin: false,
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      if (tabela === "questions") {
        const entrada = filaDeConsultas.shift();
        if (!entrada) {
          throw new Error(
            "filaDeConsultas vazia: o teste precisa enfileirar uma consulta pendente para cada carga",
          );
        }
        const builder: any = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.order = vi.fn(() => builder);
        builder.in = vi.fn(() => builder);
        builder.abortSignal = vi.fn(() => builder);
        // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
        builder.then = (resolve: any, reject?: any) => {
          entrada.consulta.promessa.then(
            (r) =>
              resolve({
                data: r.erro ? null : (r.dados ?? null),
                error: r.erro ?? null,
              }),
            reject,
          );
        };
        return builder;
      }
      if (tabela === "vw_produtos_public") {
        return builderSimples({ nome: "Vestido", imagem_url: null });
      }
      return builderSimples([]);
    }),
    channel: vi.fn(() => {
      handlersDoCanal = new Map();
      const canal: any = {};
      canal.on = vi.fn(
        (_tipo: string, cfg: any, handler: (payload: any) => void) => {
          handlersDoCanal.set(cfg.table, handler);
          return canal;
        },
      );
      canal.subscribe = vi.fn();
      return canal;
    }),
    removeChannel: vi.fn(() => Promise.resolve()),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("useQuestions — o conjunto do filtro é da carga que governa a tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let useQuestions: typeof import("@/hooks/useQuestions").useQuestions;
  let exposicao: { get: (productId: string) => Promise<void> };
  let unsubscribe: (() => void) | null = null;

  async function esperarAte(
    condicao: () => boolean,
    { timeoutMs = 2000, passoMs = 10 } = {},
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

  async function bombeia() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function entregarResposta(questionId: string | undefined) {
    await act(async () => {
      handlersDoCanal.get("answers")?.({
        eventType: "INSERT",
        new: questionId ? { id: "a1", question_id: questionId } : undefined,
        old: questionId ? {} : { id: "a1" },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
  }

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
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    ({ useQuestions } = await import("@/hooks/useQuestions"));
  }, 15000);

  beforeEach(() => {
    vi.clearAllMocks();
    acordou = 0;
    filaDeConsultas = [];
    exposicao = { get: () => Promise.resolve() };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (raiz) {
      act(() => {
        raiz.unmount();
      });
    }
    hospedeiro?.remove();
  });

  /** Monta o hook e expõe `getQuestionsByProduct` para o teste ordenar as
   * cargas à mão. A assinatura conta quantas respostas ACORDARAM. */
  async function montarProva() {
    function Prova() {
      const { subscribeToQuestions, getQuestionsByProduct } = useQuestions();
      const getRef = useRef(getQuestionsByProduct);
      useEffect(() => {
        getRef.current = getQuestionsByProduct;
        exposicao.get = (productId: string) => getRef.current(productId);
        unsubscribe = subscribeToQuestions(() => {
          acordou += 1;
        }, "prod-1");
        // eslint-disable-next-line react-hooks/exhaustive-deps -- montagem ÚNICA de propósito: o hook real muda de identidade por render (o teste chama pela latest-ref getRef); re-rodar este efeito por identidade nova registraria o mesmo listener de novo.
      }, []);
      return null;
    }
    await act(async () => {
      raiz.render(<Prova />);
    });
  }

  function perguntaDeProduto(id: string, productId: string) {
    return {
      id,
      user_id: "u1",
      product_id: productId,
      question: `Pergunta ${id}`,
      created_at: "2026-09-01T10:00:00Z",
      user: null,
      answers: [],
    };
  }

  it("carga única normal: conjunto = ids da carga — resposta de pergunta alheia não acorda, resposta da própria acorda", async () => {
    const carga = criarConsultaPendente();
    filaDeConsultas = [{ consulta: carga }];
    await montarProva();

    await act(async () => {
      void exposicao.get("prod-1");
    });
    await act(async () => {
      carga.resolverCom([perguntaDeProduto("qa1", "prod-1")]);
    });
    await bombeia();

    await entregarResposta("qa-de-outro-produto");
    await bombeia();
    expect(acordou).toBe(0);

    await entregarResposta("qa1");
    await esperarAte(() => acordou === 1);
  });

  it("corrida A lenta x B rápida: quem termina POR ÚLTIMO não rouba o conjunto da carga que governa a tela", async () => {
    const cargaA = criarConsultaPendente(); // prod-1 (velha)
    const cargaB = criarConsultaPendente(); // prod-2 (nova)
    filaDeConsultas = [{ consulta: cargaA }, { consulta: cargaB }];
    await montarProva();

    await act(async () => {
      void exposicao.get("prod-1"); // A — fica pendente
      void exposicao.get("prod-2"); // B — aborta A no AbortController real
    });

    // B termina primeiro: a tela passa a mostrar as perguntas de B.
    await act(async () => {
      cargaB.resolverCom([perguntaDeProduto("qb1", "prod-2")]);
    });
    await bombeia();

    // AGORA A termina (velha, abortada) — fora de ordem.
    await act(async () => {
      cargaA.resolverCom([perguntaDeProduto("qa1", "prod-1")]);
    });
    await bombeia();

    // O conjunto tem que continuar o de B (a tela é de B): resposta a
    // pergunta de B acorda…
    await entregarResposta("qb1");
    await esperarAte(() => acordou === 1);

    // …e resposta à pergunta da carga VELHA (A) NÃO acorda a tela de B.
    await entregarResposta("qa1");
    await bombeia();
    expect(acordou).toBe(1);
  });

  it("a carga governante falhou: conjunto fica nulo — resposta de qualquer pergunta acorda (permissivo)", async () => {
    const cargaOk = criarConsultaPendente();
    const cargaFalha = criarConsultaPendente();
    filaDeConsultas = [{ consulta: cargaOk }, { consulta: cargaFalha }];
    await montarProva();

    // Carga inicial (prod-1) conclui: conjunto = {qa1}.
    await act(async () => {
      void exposicao.get("prod-1");
    });
    await act(async () => {
      cargaOk.resolverCom([perguntaDeProduto("qa1", "prod-1")]);
    });
    await bombeia();

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // Recarga do MESMO produto falha — e é a governante.
    await act(async () => {
      void exposicao.get("prod-1");
    });
    await act(async () => {
      cargaFalha.rejeitarCom({ message: "falhou de propósito", name: "Error" });
    });
    await bombeia();
    consoleError.mockRestore();

    // Conjunto nulo = passa tudo: até pergunta alheia acorda (é melhor um
    // refetch a mais do que uma resposta invisível).
    await entregarResposta("qa-de-qualquer-produto");
    await esperarAte(() => acordou === 1);
  });

  it("a falha que chega é de uma carga VELHA (a tela já recarregou): o conjunto da carga nova permanece — o catch não reanula cegamente", async () => {
    const cargaB = criarConsultaPendente(); // prod-2 — pendente e depois falha
    const cargaC = criarConsultaPendente(); // prod-1 — conclui
    filaDeConsultas = [{ consulta: cargaB }, { consulta: cargaC }];
    await montarProva();

    await act(async () => {
      void exposicao.get("prod-2"); // B — fica pendente
      void exposicao.get("prod-1"); // C — aborta B, conclui
    });
    await act(async () => {
      cargaC.resolverCom([perguntaDeProduto("qa1", "prod-1")]);
    });
    await bombeia();

    // O catch da carga VELHA (B) chega DEPOIS que C já gravou o conjunto.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await act(async () => {
      cargaB.rejeitarCom({ message: "falhou depois", name: "Error" });
    });
    await bombeia();
    consoleError.mockRestore();

    // O conjunto continua o de C: pergunta alheia NÃO acorda.
    await entregarResposta("qa-de-outro-produto");
    await bombeia();
    expect(acordou).toBe(0);

    // E a pergunta do produto aberto acorda como sempre.
    await entregarResposta("qa1");
    await esperarAte(() => acordou === 1);
  });
});
