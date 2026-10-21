// @vitest-environment jsdom
import { StrictMode, act } from "react";
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

const perguntas: Question[] = ["a", "b"].map((id) => ({
  id,
  userId: "cliente-ficticio",
  productId: "produto-ficticio",
  customerName: "Cliente Teste",
  question: `Pergunta ${id}`,
  createdAt: "2026-10-01T09:00:00Z",
  answers: [],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "staff-ficticio" },
    profile: { full_name: "Equipe Teste" },
    isAdmin: true,
  }),
}));

// Fronteira de persistência: nenhuma conta, rede ou cliente Supabase real.
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: perguntas,
    loading: false,
    error: null,
    getQuestionsByProduct,
    addQuestion,
    addAnswer,
    subscribeToQuestions,
  }),
}));

// @ts-expect-error flag de teste interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pendente<T>() {
  let resolver!: (resultado: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

function campo(id: string) {
  const input = document.getElementById(id);
  expect(input).toBeInstanceOf(HTMLInputElement);
  return input as HTMLInputElement;
}

function digitar(id: string, valor: string) {
  act(() => {
    const input = campo(id);
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ProductQA — conclusão pertence ao rascunho enviado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  function clicar(title: string) {
    const botao = hospedeiro.querySelector<HTMLButtonElement>(
      `button[title="${title}"]`,
    );
    expect(botao).not.toBeNull();
    act(() => {
      botao!.click();
    });
  }

  function abrir(id: string) {
    const texto = [...hospedeiro.querySelectorAll("p")].find(
      (p) => p.textContent === `Pergunta ${id}`,
    )!;
    const botao = [...texto.parentElement!.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Responder Pergunta"),
    )!;
    act(() => {
      botao.click();
    });
    return campo(`qa-reply-${id}`);
  }

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(async () => {
    addQuestion.mockReset();
    addAnswer.mockReset();
    getQuestionsByProduct.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <StrictMode>
          <ProductQA productId="produto-ficticio" />
        </StrictMode>,
      );
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("preserva pergunta B digitada enquanto A está pendente", async () => {
    const envio = pendente<Question | null>();
    addQuestion.mockReturnValue(envio.promessa);
    digitar("qa-new-question", "Pergunta enviada A");
    clicar("Enviar pergunta");
    expect(addQuestion).toHaveBeenCalledWith({
      productId: "produto-ficticio",
      question: "Pergunta enviada A",
    });
    digitar("qa-new-question", "Rascunho B");
    await act(async () => {
      envio.resolver(perguntas[0]);
    });
    expect(campo("qa-new-question").value).toBe("Rascunho B");
  });

  it("limpa pergunta inalterada após sucesso", async () => {
    const envio = pendente<Question | null>();
    addQuestion.mockReturnValue(envio.promessa);
    digitar("qa-new-question", "Pergunta A");
    clicar("Enviar pergunta");
    await act(async () => {
      envio.resolver(perguntas[0]);
    });
    expect(campo("qa-new-question").value).toBe("");
  });

  it("falha da pergunta preserva a digitação posterior", async () => {
    const envio = pendente<Question | null>();
    addQuestion.mockReturnValue(envio.promessa);
    digitar("qa-new-question", "Pergunta A");
    clicar("Enviar pergunta");
    digitar("qa-new-question", "Rascunho B");
    await act(async () => {
      envio.resolver(null);
    });
    expect(campo("qa-new-question").value).toBe("Rascunho B");
  });

  it("edição que volta ao texto original ainda é uma nova intenção de pergunta", async () => {
    const envio = pendente<Question | null>();
    addQuestion.mockReturnValue(envio.promessa);
    digitar("qa-new-question", "Pergunta A");
    clicar("Enviar pergunta");
    digitar("qa-new-question", "Rascunho B");
    digitar("qa-new-question", "Pergunta A");
    await act(async () => {
      envio.resolver(perguntas[0]);
    });
    expect(campo("qa-new-question").value).toBe("Pergunta A");
  });

  it("preserva resposta B e editor enquanto envio A termina", async () => {
    const envio = pendente<boolean>();
    addAnswer.mockReturnValue(envio.promessa);
    abrir("a");
    digitar("qa-reply-a", "Resposta enviada A");
    clicar("Enviar resposta");
    expect(addAnswer).toHaveBeenCalledWith({
      questionId: "a",
      answer: "Resposta enviada A",
    });
    digitar("qa-reply-a", "Resposta B");
    await act(async () => {
      envio.resolver(true);
    });
    expect(campo("qa-reply-a").value).toBe("Resposta B");
  });

  it("sucesso do alvo A não fecha resposta de B mesmo com texto igual", async () => {
    const envio = pendente<boolean>();
    addAnswer.mockReturnValue(envio.promessa);
    abrir("a");
    digitar("qa-reply-a", "Mesmo texto");
    clicar("Enviar resposta");
    abrir("b");
    digitar("qa-reply-b", "Mesmo texto");
    await act(async () => {
      envio.resolver(true);
    });
    expect(campo("qa-reply-b").value).toBe("Mesmo texto");
    expect(document.getElementById("qa-reply-a")).toBeNull();
  });

  it("falha da resposta preserva novo texto e alvo", async () => {
    const envio = pendente<boolean>();
    addAnswer.mockReturnValue(envio.promessa);
    abrir("a");
    digitar("qa-reply-a", "Resposta A");
    clicar("Enviar resposta");
    abrir("b");
    digitar("qa-reply-b", "Resposta B");
    await act(async () => {
      envio.resolver(false);
    });
    expect(campo("qa-reply-b").value).toBe("Resposta B");
  });

  it("resposta inalterada limpa e fecha; reabrir começa vazio", async () => {
    const envio = pendente<boolean>();
    addAnswer.mockReturnValue(envio.promessa);
    abrir("a");
    digitar("qa-reply-a", "Resposta A");
    clicar("Enviar resposta");
    await act(async () => {
      envio.resolver(true);
    });
    expect(document.getElementById("qa-reply-a")).toBeNull();
    expect(abrir("a").value).toBe("");
  });

  it("cancelar e reabrir o mesmo alvo invalida a conclusão antiga", async () => {
    const envio = pendente<boolean>();
    addAnswer.mockReturnValue(envio.promessa);
    abrir("a");
    digitar("qa-reply-a", "Resposta A");
    clicar("Enviar resposta");
    const cancelar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancelar",
    )!;
    act(() => {
      cancelar.click();
    });
    abrir("a");
    digitar("qa-reply-a", "Resposta A");
    await act(async () => {
      envio.resolver(true);
    });
    expect(campo("qa-reply-a").value).toBe("Resposta A");
  });
});
