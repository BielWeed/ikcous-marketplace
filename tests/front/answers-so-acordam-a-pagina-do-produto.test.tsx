// @vitest-environment jsdom
//
// Laudo novos-ângulos 01/09, achado C4 (ponta 1): a página de produto
// assinava `answers` SEM filtro — a tabela não tem product_id, e a resposta
// de QUALQUER produto acordava TODAS as abas de produto abertas, cada uma
// relendo as perguntas do seu produto no banco.
//
// O conserto é a guarda pelo question_id conhecido: o hook sabe que
// perguntas pertencem ao produto aberto (ele acabou de carregá-las), então
// um evento de resposta cujo `question_id` está fora desse conjunto não
// acorda a página. Exceção de propósito: DELETE real de resposta replica
// só a PK no `old` — sem question_id o evento PASSA (conservador: é melhor
// um refetch a mais do que uma resposta que não aparece).
//
// O teste exercita o hook REAL com o canal de realtime dublê: carrega as
// perguntas do produto, entrega eventos no handler do canal `answers` e
// conta quantas releituras o produto sofreu.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PERGUNTAS_DO_PRODUTO = [
  {
    id: "q1",
    user_id: "u1",
    product_id: "prod-1",
    question: "Tem tamanho G?",
    created_at: "2026-09-01T10:00:00Z",
    user: null,
    answers: [],
  },
  {
    id: "q2",
    user_id: "u2",
    product_id: "prod-1",
    question: "Qual o prazo?",
    created_at: "2026-09-01T09:00:00Z",
    user: null,
    answers: [],
  },
];

let consultasDeQuestions = 0;

function builderQuestions() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.abortSignal = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: { nome: "Vestido", imagem_url: null } }),
  );
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) => {
    consultasDeQuestions += 1;
    return Promise.resolve({ data: PERGUNTAS_DO_PRODUTO, error: null }).then(
      resolve,
      reject,
    );
  };
  return builder;
}

function builderSimples(dados: any) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.abortSignal = vi.fn(() => builder);
  // No cliente real `maybeSingle()` devolve OUTRO builder thenable (que
  // também aceita abortSignal) — não uma Promise. Devolver Promise aqui
  // quebrava a cadeia `.abortSignal(signal)` do hook.
  builder.maybeSingle = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: dados, error: null }).then(resolve, reject);
  return builder;
}

let handlersDoCanal: Map<string, (payload: any) => void> = new Map();

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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      if (tabela === "questions") return builderQuestions();
      if (tabela === "vw_produtos_public")
        return builderSimples({ nome: "Vestido", imagem_url: null });
      if (tabela === "marketplace_orders") return builderSimples([]);
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
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("useQuestions — resposta de outro produto não acorda a página aberta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let useQuestions: typeof import("@/hooks/useQuestions").useQuestions;

  async function esperarAte(
    condicao: () => boolean,
    { timeoutMs = 2000, passoMs = 10 } = {},
  ) {
    await act(async () => {
      const inicio = Date.now();
      while (!condicao()) {
        if (Date.now() - inicio > timeoutMs) {
          throw new Error(
            `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms; DOM: ${hospedeiro.innerHTML}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, passoMs));
      }
    });
  }

  function eventoDeResposta(questionId: string | undefined) {
    return {
      eventType: "INSERT",
      new: questionId ? { id: "a1", question_id: questionId } : undefined,
      old: questionId ? {} : { id: "a1" },
    };
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
    // O jsdom deste projeto não traz localStorage — o cache de perguntas
    // do hook cai no catch gracefully, mas o stub deixa o caminho limpo.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    ({ useQuestions } = await import("@/hooks/useQuestions"));
  }, 15000);

  beforeEach(() => {
    consultasDeQuestions = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  async function montarProva() {
    function Prova() {
      const { subscribeToQuestions, getQuestionsByProduct, questions } =
        useQuestions();
      // Mesma montagem do ProductQA real: carga inicial + assinatura.
      useEffect(() => {
        getQuestionsByProduct("prod-1");
        const unsubscribe = subscribeToQuestions(() => {
          getQuestionsByProduct("prod-1");
        }, "prod-1");
        return () => {
          unsubscribe();
        };
      }, [getQuestionsByProduct, subscribeToQuestions]);
      // O contador de consultas sobe quando a QUERY resolve, mas as
      // perguntas formatadas (que alimentam o conjunto do filtro) chegam
      // no estado em microtask depois. Só vale entregar eventos quando o
      // estado já mostra as 2 perguntas — é a garantia de que o conjunto
      // do filtro já existe.
      return <div data-count={questions.length} />;
    }
    await act(async () => {
      raiz.render(<Prova />);
    });
    await esperarAte(
      () =>
        hospedeiro.querySelector("[data-count]")?.getAttribute("data-count") ===
        "2",
    );
  }

  async function entregar(questionId: string | undefined) {
    await act(async () => {
      handlersDoCanal.get("answers")?.(eventoDeResposta(questionId));
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("resposta do produto aberto refaz a leitura (comportamento de sempre)", async () => {
    await montarProva();

    await entregar("q1");

    await esperarAte(() => consultasDeQuestions >= 2);
  });

  it("resposta de PERGUNTA DE OUTRO PRODUTO não refaz a leitura", async () => {
    await montarProva();
    const depoisDaCarga = consultasDeQuestions;

    await entregar("q-de-outro-produto");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(consultasDeQuestions).toBe(depoisDaCarga);
  });

  it("resposta em produto distinto NÃO repete o refetch em rajada", async () => {
    await montarProva();
    const depoisDaCarga = consultasDeQuestions;

    await entregar("q-alheia-1");
    await entregar("q-alheia-2");
    await entregar("q-alheia-3");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(consultasDeQuestions).toBe(depoisDaCarga);
  });

  it("evento sem question_id (DELETE real) passa: um refetch a mais é melhor que resposta invisível", async () => {
    await montarProva();
    const depoisDaCarga = consultasDeQuestions;

    await entregar(undefined);

    await esperarAte(() => consultasDeQuestions > depoisDaCarga);
  });
});
