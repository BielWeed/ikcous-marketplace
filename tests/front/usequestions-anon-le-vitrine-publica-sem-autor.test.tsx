// @vitest-environment jsdom
//
// I-3 (brief hub-0809-g 08/09/2026:
// equipe/entregas/20260908-brief-i3-i4-anon-nao-le-autor-nem-grava-analytics.md).
//
// O DEFEITO: `getQuestionsByProduct` (chamada incondicionalmente por
// `ProductQA.tsx`, para QUALQUER visitante da página do produto) consultava
// `.from("questions").select("*, ...")` direto na tabela — `user_id`
// viajava no payload de todo visitante sem login (`questions_select_policy`
// era `USING (true)`, sem checar sessão nenhuma).
//
// O CONSERTO: sem sessão (`user` nulo em `useAuth`), o hook passa a
// consultar `vw_questions_public` (20261110000000) — a view nunca teve
// `user_id`. As respostas da loja (`answers`) continuam vindo por uma
// segunda consulta na tabela `answers`, que já era 100% pública e não muda
// nesta frente. O selo "Comprador" (`is_verified_buyer`, calculado DENTRO
// da view) continua chegando, sem o id de quem comprou. Quem está logado
// continua na tabela, sem mudança.
vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    class BroadcastChannelFalso {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
      BroadcastChannelFalso;
  }
});

const h = vi.hoisted(() => ({
  chamadasFrom: [] as string[],
  linhaAnon: [] as unknown[],
  linhaLogado: [] as unknown[],
  respostas: [] as unknown[],
  usuarioLogado: null as { id: string } | null,
}));

function builderSimples(resultado: () => unknown) {
  const builder: any = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.in = () => builder;
  builder.order = () => builder;
  builder.maybeSingle = () => builder;
  builder.abortSignal = () => builder;
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve(resultado()).then(resolve, reject);
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      h.chamadasFrom.push(tabela);
      if (tabela === "vw_questions_public") {
        return builderSimples(() => ({ data: h.linhaAnon, error: null }));
      }
      if (tabela === "questions") {
        return builderSimples(() => ({ data: h.linhaLogado, error: null }));
      }
      if (tabela === "answers") {
        return builderSimples(() => ({ data: h.respostas, error: null }));
      }
      if (tabela === "vw_produtos_public") {
        return builderSimples(() => ({
          data: { nome: "Produto Teste", imagem_url: null },
          error: null,
        }));
      }
      if (tabela === "marketplace_orders") {
        return builderSimples(() => ({ data: [], error: null }));
      }
      return builderSimples(() => ({ data: [], error: null }));
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuarioLogado, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedQuestionsData: null,
  setCachedQuestionsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "@/hooks/useQuestions";
import type { Question } from "@/hooks/useQuestions";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function criarLocalStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("getQuestionsByProduct — o visitante anônimo lê a vitrine pública, sem o autor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.chamadasFrom = [];
    h.linhaAnon = [];
    h.linhaLogado = [];
    h.respostas = [];
    h.usuarioLogado = null;
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    localStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  type GetQuestionsByProduct = (productId: string) => Promise<void>;

  const buscarPerguntasDoProduto = async (
    productId: string,
  ): Promise<Question[]> => {
    type SondaProps = {
      readonly aoCapturar: (m: GetQuestionsByProduct) => void;
      readonly aoRenderizar: (lista: Question[]) => void;
    };
    const capturada = vi.fn((_metodo: GetQuestionsByProduct) => {});
    const renderizada = vi.fn((_lista: Question[]) => {});

    function Sonda({ aoCapturar, aoRenderizar }: SondaProps) {
      const { getQuestionsByProduct, questions } = useQuestions();
      useEffect(() => {
        aoCapturar(getQuestionsByProduct as GetQuestionsByProduct);
      }, [getQuestionsByProduct, aoCapturar]);
      useEffect(() => {
        aoRenderizar(questions);
      }, [questions, aoRenderizar]);
      return null;
    }

    await act(async () => {
      raiz.render(<Sonda aoCapturar={capturada} aoRenderizar={renderizada} />);
    });
    const metodo = capturada.mock.calls.at(-1)?.[0];
    if (!metodo) throw new Error("A sonda não capturou getQuestionsByProduct");

    await act(async () => {
      await metodo(productId);
    });

    const ultima = renderizada.mock.calls.at(-1)?.[0];
    if (!ultima) throw new Error("A sonda não recebeu a lista de perguntas");
    return ultima;
  };

  it("visitante SEM sessão: pede vw_questions_public, nunca questions, e o objeto não carrega userId", async () => {
    h.usuarioLogado = null;
    h.linhaAnon = [
      {
        id: "q-1",
        product_id: "prod-bolsa",
        question: "Tem em outra cor?",
        created_at: "2026-08-20T12:00:00.000Z",
        author_name: "Marina",
        author_avatar_url: null,
        is_verified_buyer: true,
      },
    ];
    h.respostas = [
      {
        id: "a-1",
        question_id: "q-1",
        answer: "Temos em azul e preto!",
        created_at: "2026-08-20T13:00:00.000Z",
      },
    ];

    const perguntas = await buscarPerguntasDoProduto("prod-bolsa");

    expect(h.chamadasFrom).toContain("vw_questions_public");
    expect(h.chamadasFrom).not.toContain("questions");

    expect(perguntas).toHaveLength(1);
    expect(perguntas[0]?.userId).toBeUndefined();
    expect(perguntas[0]).toMatchObject({
      id: "q-1",
      productId: "prod-bolsa",
      customerName: "Marina",
      question: "Tem em outra cor?",
      isVerified: true,
    });
    expect(perguntas[0]?.answers).toHaveLength(1);
    expect(perguntas[0]?.answers[0]?.answer).toBe("Temos em azul e preto!");
  });

  it("visitante COM sessão: continua pedindo a tabela questions, comportamento inalterado", async () => {
    h.usuarioLogado = { id: "cliente-1" };
    h.linhaLogado = [
      {
        id: "q-2",
        product_id: "prod-caneca",
        user_id: "cliente-9",
        question: "Qual o material?",
        created_at: "2026-08-21T09:30:00.000Z",
        user: { full_name: "Rafa", avatar_url: null },
        answers: [],
      },
    ];

    const perguntas = await buscarPerguntasDoProduto("prod-caneca");

    expect(h.chamadasFrom).toContain("questions");
    expect(h.chamadasFrom).not.toContain("vw_questions_public");

    expect(perguntas).toHaveLength(1);
    expect(perguntas[0]?.userId).toBe("cliente-9");
    expect(perguntas[0]?.customerName).toBe("Rafa");
  });
});
