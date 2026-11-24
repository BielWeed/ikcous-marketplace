// @vitest-environment jsdom
//
// Perguntas da página do produto lidas por QUEM ESTÁ LOGADO (não admin): as
// respostas de cada pergunta chegam do banco numa ordem qualquer (a junção
// `answers:answers(*)` não promete ordem) e o hook as entrega da MAIS ANTIGA
// para a MAIS NOVA — é essa ordem que o ProductQA assume quando pré-preenche
// "Editar resposta" com a última (`answers.at(-1)`). Caça por mutação
// (24/11/2026): o ramo do visitante já tinha prova, mas inverter a ordenação
// do ramo de quem está logada não derrubava teste algum.
import { useQuestions } from "@/hooks/useQuestions";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  linhas: [] as unknown[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-logada" }, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      const b: any = {};
      for (const nome of [
        "select",
        "eq",
        "order",
        "in",
        "maybeSingle",
        "abortSignal",
        "limit",
      ]) {
        // eslint-disable-next-line security/detect-object-injection -- nomes fixos do builder de teste
        b[nome] = () => b;
      }
      // biome-ignore lint/suspicious/noThenProperty: builder Supabase simulado
      b.then = (
        resolve: (valor: unknown) => unknown,
        reject: (motivo: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: tabela === "questions" ? h.linhas : [],
          error: null,
        }).then(resolve, reject);
      return b;
    },
  },
}));

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
let questions: ReturnType<typeof useQuestions>;
function Sonda() {
  const q = useQuestions();
  useEffect(() => {
    questions = q;
  });
  return null;
}

beforeEach(async () => {
  h.linhas = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  raiz = createRoot(host);
  await act(async () => {
    raiz.render(<Sonda />);
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

it("respostas fora de ordem no banco saem da mais antiga para a mais nova", async () => {
  const resposta = (id: string, criada: string) => ({
    id,
    question_id: "q1",
    answer: `texto ${id}`,
    created_at: criada,
  });
  h.linhas = [
    {
      id: "q1",
      user_id: "autora",
      product_id: "produto-ordem",
      question: "Tem azul?",
      created_at: "2026-11-01T09:00:00Z",
      user: { nome_publico: "Ana B.", avatar_url: null },
      answers: [
        resposta("a-nova", "2026-11-03T10:00:00Z"),
        resposta("a-velha", "2026-11-01T10:00:00Z"),
        resposta("a-meio", "2026-11-02T10:00:00Z"),
      ],
    },
  ];

  await act(async () => {
    await questions.getQuestionsByProduct("produto-ordem");
  });

  expect(questions.questions).toHaveLength(1);
  expect(questions.questions[0].customerName).toBe("Ana B.");
  expect(questions.questions[0].answers.map((a) => a.id)).toEqual([
    "a-velha",
    "a-meio",
    "a-nova",
  ]);
});

it("pergunta sem nenhuma resposta (coluna ausente) chega com lista vazia, não quebra", async () => {
  h.linhas = [
    {
      id: "q2",
      user_id: "autora",
      product_id: "produto-sem-resposta",
      question: "Qual o prazo?",
      created_at: "2026-11-01T09:00:00Z",
      user: null,
      answers: null,
    },
  ];

  await act(async () => {
    await questions.getQuestionsByProduct("produto-sem-resposta");
  });

  expect(questions.questions[0].answers).toEqual([]);
  expect(questions.questions[0].customerName).toBe("Cliente");
});
