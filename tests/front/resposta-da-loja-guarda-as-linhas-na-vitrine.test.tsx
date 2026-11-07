// @vitest-environment jsdom
//
// A resposta da loja a uma pergunta pode ter várias linhas (lista de tamanhos,
// passo a passo, endereço). No painel ela aparece em linhas, mas na página do
// produto o <p> não preservava a quebra e a cliente via tudo numa linha só.
// Pior: o campo de "Editar Resposta" era um <input type="text">, que descarta
// as quebras ao pré-preencher — salvar sem mexer em nada gravava a resposta
// achatada no banco.
//
// O CSS do Tailwind não existe no jsdom: o que se prova é a classe do
// parágrafo (`whitespace-pre-line`) e, no campo, o tipo do elemento e o valor
// que ele realmente guarda (o jsdom, como o navegador, tira as quebras de um
// <input> e mantém as de um <textarea>).
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

const RESPOSTA_EM_LINHAS = "Tamanhos disponíveis:\nP - 36\nM - 38";

const pergunta: Question = {
  id: "question-1",
  userId: "user-1",
  productId: "prod-1",
  customerName: "Cliente Teste",
  question: "Quais tamanhos tem?",
  createdAt: "2026-08-01T09:00:00Z",
  answers: [
    {
      id: "answer-1",
      questionId: "question-1",
      answer: RESPOSTA_EM_LINHAS,
      createdAt: "2026-08-01T10:00:00Z",
    },
  ],
};

const addAnswer = vi.fn().mockResolvedValue(true);

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1", email: "admin@ikcous.com" },
    profile: { full_name: "Admin", avatar_url: null },
    isAdmin: true,
  }),
}));

// Sem vi.importActual: o módulo real cria um client Supabase só de ser
// importado (mesmo comentário de product-qa-edit-prefill.test.tsx).
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [pergunta],
    loading: false,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer,
    subscribeToQuestions: vi.fn(() => () => {}),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ProductQA — resposta da loja com várias linhas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  // Import dinâmico fora do orçamento por teste (mesmo motivo de
  // product-qa-edit-prefill.test.tsx).
  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
    addAnswer.mockClear();
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

  async function montar() {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });
  }

  it("o texto da resposta preserva as quebras de linha na vitrine", async () => {
    await montar();

    const paragrafo = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>("p"),
    ).find((p) => p.textContent?.includes("Tamanhos disponíveis:"));
    expect(paragrafo, "parágrafo da resposta").toBeTruthy();
    // O texto chega ao DOM com as quebras; é a classe que as faz aparecer.
    expect(paragrafo!.textContent).toContain(RESPOSTA_EM_LINHAS);
    expect(paragrafo!.classList.contains("whitespace-pre-line")).toBe(true);
  });

  it("editar a resposta: o campo é de várias linhas e guarda as quebras", async () => {
    await montar();

    const abrir = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Editar Resposta"),
    );
    expect(abrir).toBeDefined();
    await act(async () => {
      abrir!.click();
    });

    const campo = document.getElementById("qa-reply-question-1");
    expect(campo).not.toBeNull();
    expect(campo!.tagName).toBe("TEXTAREA");
    expect((campo as HTMLTextAreaElement).value).toBe(RESPOSTA_EM_LINHAS);
  });

  // Num <input type="text"> o navegador tira as quebras ao pré-preencher, e o
  // primeiro toque no campo manda o valor já achatado para o estado: acrescentar
  // uma palavra e salvar gravava a resposta inteira numa linha só.
  it("acrescentar uma frase à resposta e salvar mantém as quebras de antes", async () => {
    await montar();

    const abrir = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Editar Resposta"),
    );
    await act(async () => {
      abrir!.click();
    });
    const campo = document.getElementById("qa-reply-question-1") as
      | HTMLInputElement
      | HTMLTextAreaElement;
    // Setter do protótipo certo para o tipo do elemento (o do <input> não
    // serve num <textarea>): é o que o navegador faria ao digitar.
    const prototipo =
      campo.tagName === "TEXTAREA"
        ? globalThis.HTMLTextAreaElement.prototype
        : globalThis.HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(
        campo,
        `${RESPOSTA_EM_LINHAS}
G - 40`,
      );
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const salvar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Salvar edição"]',
    );
    await act(async () => {
      salvar!.click();
    });

    expect(addAnswer).toHaveBeenCalledWith({
      questionId: "question-1",
      answer: `${RESPOSTA_EM_LINHAS}
G - 40`,
    });
  });

  it("salvar a edição sem mexer manda a resposta com as quebras intactas", async () => {
    await montar();

    const abrir = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Editar Resposta"),
    );
    await act(async () => {
      abrir!.click();
    });
    const salvar = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Salvar edição"]',
    );
    expect(salvar).not.toBeNull();
    await act(async () => {
      salvar!.click();
    });

    expect(addAnswer).toHaveBeenCalledTimes(1);
    expect(addAnswer).toHaveBeenCalledWith({
      questionId: "question-1",
      answer: RESPOSTA_EM_LINHAS,
    });
  });
});
