// @vitest-environment jsdom
//
// O campo de pergunta (e o de resposta) não pode apagar o texto da cliente
// quando o envio FALHA. addQuestion/addAnswer do useQuestions tratam o erro
// com toast e devolvem null/false — nunca lançam —, mas ProductQA limpava o
// campo incondicionalmente depois do await. Em rede fraca, a cliente que
// escreveu três linhas perdia tudo junto com o toast que some em segundos.
// O padrão correto já existia em ReviewForm.tsx ("só reseta if (result)").
//
// Render de verdade (react-dom/client + jsdom) com clique e digitação reais.
import { act } from "react";
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

import type { Answer, Question } from "@/hooks/useQuestions";

const addQuestion = vi.fn();
const addAnswer = vi.fn();
const getQuestionsByProduct = vi.fn();
const subscribeToQuestions = vi.fn(() => () => {});

const respostaAntiga: Answer = {
  id: "answer-1",
  questionId: "question-respondida",
  answer: "Sim, temos em 3 cores.",
  createdAt: "2026-08-01T10:00:00Z",
};

const perguntaRespondida: Question = {
  id: "question-respondida",
  userId: "user-1",
  productId: "prod-1",
  customerName: "Cliente Teste",
  question: "Tem em outras cores?",
  createdAt: "2026-08-01T09:00:00Z",
  answers: [respostaAntiga],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1", email: "admin@ikcous.com" },
    profile: { full_name: "Admin", avatar_url: null },
    isAdmin: true,
  }),
}));

// Sem vi.importActual: o módulo real importa @/lib/supabase, que cria um
// client de verdade (Web Worker, indisponível no jsdom) só de ser importado —
// mesmo comentário de product-qa-edit-prefill.test.tsx.
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [perguntaRespondida],
    loading: false,
    getQuestionsByProduct,
    addQuestion,
    addAnswer,
    subscribeToQuestions,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// product-qa-edit-prefill.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mesmo padrão de product-qa-edit-prefill.test.tsx: dispara o setter nativo
// do input para o onChange controlado do React ver o novo valor.
function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTitle(title: string, dentroDe: HTMLElement) {
  return [...dentroDe.querySelectorAll("button")].find(
    (b) => b.getAttribute("title") === title,
  ) as HTMLButtonElement | undefined;
}

describe("ProductQA — texto digitado não some quando o envio falha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
    addQuestion.mockReset();
    addAnswer.mockReset();
    getQuestionsByProduct.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("PERGUNTA cujo envio falha (addQuestion devolve null): o texto fica no campo", async () => {
    addQuestion.mockResolvedValue(null); // o hook trata o erro e devolve null
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });

    digitar("qa-new-question", "Qual o prazo de entrega para o interior?");
    const enviar = botaoPorTitle("Enviar pergunta", hospedeiro);
    expect(enviar).toBeDefined();

    await act(async () => {
      enviar!.click();
      await Promise.resolve();
    });

    const campo = document.getElementById(
      "qa-new-question",
    ) as HTMLInputElement;
    expect(campo.value).toBe("Qual o prazo de entrega para o interior?");
  });

  it("PERGUNTA enviada com sucesso: o campo limpa", async () => {
    addQuestion.mockResolvedValue(perguntaRespondida);
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });

    digitar("qa-new-question", "Aceita cartão na entrega?");
    const enviar = botaoPorTitle("Enviar pergunta", hospedeiro);

    await act(async () => {
      enviar!.click();
      await Promise.resolve();
    });

    const campo = document.getElementById(
      "qa-new-question",
    ) as HTMLInputElement;
    expect(campo.value).toBe("");
  });

  it("RESPOSTA cujo envio falha (addAnswer devolve false): o texto fica na caixa", async () => {
    addAnswer.mockResolvedValue(false);
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });

    // Abre a caixa de resposta na pergunta JÁ respondida (title vira
    // "Salvar edição") — é a caixa de edição que corre risco de perder texto.
    const abrir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Editar Resposta"),
    ) as HTMLButtonElement | undefined;
    expect(abrir).toBeDefined();
    await act(async () => {
      abrir!.click();
    });

    digitar("qa-reply-question-respondida", "Resposta nova, digitada agora.");
    const enviar = botaoPorTitle("Salvar edição", hospedeiro);
    expect(enviar).toBeDefined();

    await act(async () => {
      enviar!.click();
      await Promise.resolve();
    });

    const campo = document.getElementById(
      "qa-reply-question-respondida",
    ) as HTMLInputElement;
    expect(campo.value).toBe("Resposta nova, digitada agora.");
  });
});
