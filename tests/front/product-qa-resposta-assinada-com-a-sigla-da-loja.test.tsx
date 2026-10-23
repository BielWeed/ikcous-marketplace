// @vitest-environment jsdom
//
// A resposta da loja às perguntas do produto vinha sempre assinada com o
// círculo "IK" (sigla da IKCOUS), inclusive na loja da Savy: o cliente final
// via a sigla de outra empresa. Agora o círculo leva as iniciais do nome da
// loja em que a pessoa está.
//
// Vermelho contra o HEAD: o ProductQA antigo escrevia "IK" fixo.
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

import { iniciaisDaLoja } from "@/lib/iniciais-da-loja";

import type { Question } from "@/hooks/useQuestions";

const perguntaRespondida: Question = {
  id: "question-respondida",
  userId: "user-1",
  productId: "prod-1",
  customerName: "Cliente Teste",
  question: "Tem em outras cores?",
  createdAt: "2026-08-01T09:00:00Z",
  answers: [
    {
      id: "answer-1",
      questionId: "question-respondida",
      answer: "Sim, temos em 3 cores.",
      createdAt: "2026-08-01T10:00:00Z",
    },
  ],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "cliente@teste.com" },
    profile: null,
    isAdmin: false,
  }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [perguntaRespondida],
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("iniciaisDaLoja", () => {
  it.each([
    ["Savy", "SA"],
    ["Savy Collection", "SC"],
    ["  savy  ", "SA"],
    ["Água Viva", "ÁV"],
    ["X", "X"],
    ["", ""],
    ["   ", ""],
  ])("'%s' vira '%s'", (nome, esperado) => {
    expect(iniciaisDaLoja(nome)).toBe(esperado);
  });
});

describe("ProductQA — a resposta leva a sigla da loja, nunca a da IKCOUS", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
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

  async function renderizar(nomeDaLoja?: string) {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" nomeDaLoja={nomeDaLoja} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  it("loja Savy: o círculo da resposta diz SA e não IK", async () => {
    const texto = await renderizar("Savy");
    expect(texto).toContain("Sim, temos em 3 cores.");
    expect(texto).toContain("SA");
    expect(texto).not.toContain("IK");
  });

  it("nome da loja em branco: cai no nome do build, nunca num literal fixo", async () => {
    const texto = await renderizar("   ");
    expect(texto).toContain("Sim, temos em 3 cores.");
    expect(texto).not.toContain("IK");
  });
});
