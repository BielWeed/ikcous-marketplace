// @vitest-environment jsdom
//
// A caixa de resposta do admin na PÁGINA DO PRODUTO (segundo chamador de
// addAnswer, além do painel) conferia "tem texto" só com trim(): um admin que
// colasse só U+200B / U+200E / U+2060 / U+2800 / U+3164 publicava uma resposta
// aparentemente em branco, visível à cliente na vitrine. O painel (#1475) já
// usa nomeTemConteudoVisivel; esta caixa precisa da mesma regra, e o texto
// real sai aparado.
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

import type { Question } from "@/hooks/useQuestions";

const addQuestion = vi.fn();
const addAnswer = vi.fn();
const getQuestionsByProduct = vi.fn();
const subscribeToQuestions = vi.fn(() => () => {});

const perguntaSemResposta: Question = {
  id: "question-aberta",
  userId: "user-1",
  productId: "prod-1",
  customerName: "Cliente Teste",
  question: "Tem em outras cores?",
  createdAt: "2026-08-01T09:00:00Z",
  answers: [],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1", email: "admin@ikcous.com" },
    profile: { full_name: "Admin", avatar_url: null },
    isAdmin: true,
  }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [perguntaSemResposta],
    loading: false,
    getQuestionsByProduct,
    addQuestion,
    addAnswer,
    subscribeToQuestions,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
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

const INVISIVEIS = [
  "\u200b\u200b\u200b",
  "\u200e",
  "\u2060",
  "\u2800",
  "\u3164",
];

describe("ProductQA — resposta do admin só com caractere invisível não publica", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
    addAnswer.mockReset();
    addAnswer.mockResolvedValue(true);
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

  async function abrirCaixa() {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });
    const abrir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Responder"),
    ) as HTMLButtonElement | undefined;
    expect(abrir).toBeDefined();
    await act(async () => {
      abrir!.click();
    });
  }

  it.each(INVISIVEIS)(
    "resposta só com %j: botão desligado e nada é enviado",
    async (texto) => {
      await abrirCaixa();
      digitar("qa-reply-question-aberta", texto);
      const enviar = botaoPorTitle("Enviar resposta", hospedeiro);
      expect(enviar).toBeDefined();
      expect(enviar!.disabled).toBe(true);
      await act(async () => {
        enviar!.click();
        await Promise.resolve();
      });
      expect(addAnswer).not.toHaveBeenCalled();
    },
  );

  it("controle: texto real com espaços nas pontas é enviado aparado", async () => {
    await abrirCaixa();
    digitar("qa-reply-question-aberta", "  Temos em 3 cores.  ");
    const enviar = botaoPorTitle("Enviar resposta", hospedeiro);
    expect(enviar!.disabled).toBe(false);
    await act(async () => {
      enviar!.click();
      await Promise.resolve();
    });
    expect(addAnswer).toHaveBeenCalledTimes(1);
    expect(addAnswer).toHaveBeenCalledWith({
      questionId: "question-aberta",
      answer: "Temos em 3 cores.",
    });
  });
});
