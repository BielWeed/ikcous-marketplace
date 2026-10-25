// @vitest-environment jsdom
//
// Caça 4 (24/10/2026), achado V5 (só tela, sem mexer no banco): pergunta e
// avaliação não tinham limite de tamanho e o parágrafo não quebrava palavra
// comprida. Uma "palavra" de 300 letras (ou um link) alargava o cartão e a
// página rolava para o lado. Agora: pergunta até 500 caracteres, comentário
// da avaliação até 1000, e `break-words` nos textos de pergunta, resposta,
// avaliação e resposta da loja.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Answer, Question } from "@/hooks/useQuestions";

const resposta: Answer = {
  id: "a-1",
  questionId: "q-1",
  answer: "R".repeat(80),
  createdAt: "2026-10-01T10:00:00Z",
};

const pergunta: Question = {
  id: "q-1",
  userId: "u-1",
  productId: "p-1",
  customerName: "Cliente",
  question: "P".repeat(80),
  createdAt: "2026-10-01T09:00:00Z",
  answers: [resposta],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "c@ikcous.com" },
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

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("texto longo de pergunta e avaliação (V5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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

  it("ProductQA: o campo da pergunta aceita no máximo 500 caracteres", async () => {
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await act(async () => {
      raiz.render(<ProductQA productId="p-1" />);
    });
    const campo = document.getElementById(
      "qa-new-question",
    ) as HTMLInputElement;
    expect(campo.maxLength).toBe(500);
  });

  it("ProductQA: o texto da pergunta e o da resposta quebram palavra comprida", async () => {
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    await act(async () => {
      raiz.render(<ProductQA productId="p-1" />);
    });
    const paragrafo = (texto: string) =>
      Array.from(hospedeiro.querySelectorAll("p")).find((p) =>
        p.textContent?.includes(texto),
      );
    expect(paragrafo("P".repeat(80))?.classList.contains("break-words")).toBe(
      true,
    );
    expect(paragrafo("R".repeat(80))?.classList.contains("break-words")).toBe(
      true,
    );
  });

  it("ReviewForm: o comentário aceita no máximo 1000 caracteres", async () => {
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" />);
    });
    const area = hospedeiro.querySelector("textarea") as HTMLTextAreaElement;
    expect(area).toBeTruthy();
    expect(area.maxLength).toBe(1000);
  });

  it("ReviewCard: o comentário e a resposta da loja quebram palavra comprida", async () => {
    const { ReviewCard } = await import("@/components/ui/custom/ReviewCard");
    await act(async () => {
      raiz.render(
        <ReviewCard
          review={{
            id: "r-1",
            productId: "p-1",
            customerName: "Cliente",
            rating: 5,
            comment: "C".repeat(80),
            helpful: 0,
            verified: true,
            merchantReply: "L".repeat(80),
            createdAt: "2026-10-01T12:00:00Z",
          }}
        />,
      );
    });
    const paragrafo = (texto: string) =>
      Array.from(hospedeiro.querySelectorAll("p")).find((p) =>
        p.textContent?.includes(texto),
      );
    expect(paragrafo("C".repeat(80))?.classList.contains("break-words")).toBe(
      true,
    );
    expect(paragrafo("L".repeat(80))?.classList.contains("break-words")).toBe(
      true,
    );
  });
});
