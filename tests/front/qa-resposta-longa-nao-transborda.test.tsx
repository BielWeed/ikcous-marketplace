// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Answer, Question } from "@/hooks/useQuestions";

const resposta: Answer = {
  id: "a-1",
  questionId: "q-1",
  answer: `https://exemplo.test/${"r".repeat(300)}`,
  createdAt: "2026-10-01T10:00:00Z",
};

const pergunta: Question = {
  id: "q-1",
  userId: "u-1",
  productId: "p-1",
  customerName: "Cliente",
  question: "P".repeat(300),
  createdAt: "2026-10-01T09:00:00Z",
  answers: [resposta],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u-1" },
    profile: { full_name: "Cliente", avatar_url: null },
    isAdmin: false,
  }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [pergunta],
    loading: false,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    subscribeToQuestions: vi.fn(() => () => {}),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("pergunta e resposta longas cabem no cartão", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it.each([
    ["pergunta", pergunta.question],
    ["resposta", resposta.answer],
  ])("%s permite encolher o contêiner e quebrar palavras", async (_, texto) => {
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await act(async () => {
      raiz.render(<ProductQA productId="p-1" />);
    });

    // jsdom não mede largura: protegemos as duas classes que permitem a quebra.
    const paragrafo = Array.from(hospedeiro.querySelectorAll("p")).find((p) =>
      p.textContent?.includes(texto),
    );
    expect(paragrafo).toBeDefined();
    expect(paragrafo?.classList.contains("break-words")).toBe(true);
    expect(paragrafo?.parentElement?.classList.contains("min-w-0")).toBe(true);
  });
});
