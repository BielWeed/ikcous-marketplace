// @vitest-environment jsdom
//
// A pergunta (ate 500 caracteres) digitada em "Perguntas ao vendedor" se
// perdia quando uma atualizacao do app era instalada. Enquanto houver texto na
// pergunta ou na resposta, a operacao fica marcada como sensivel e a
// atualizacao espera; ao enviar, limpar ou sair da tela, a marca sai.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";

const addQuestion = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "cliente-ficticio" },
    profile: { full_name: "Cliente Teste" },
    isAdmin: false,
  }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    addQuestion,
    addAnswer: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));

// @ts-expect-error flag de teste interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(valor: string) {
  act(() => {
    const input = document.getElementById(
      "qa-new-question",
    ) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ProductQA: pergunta digitada segura a atualizacao", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    addQuestion.mockReset();
    const { ProductQA } = await import("@/components/ui/custom/ProductQA");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<ProductQA productId="produto-ficticio" />);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("sem texto nao ha operacao sensivel; com texto ha", () => {
    expect(haOperacaoSensivel()).toBe(false);
    digitar("Qual o prazo de entrega?");
    expect(haOperacaoSensivel()).toBe(true);
  });

  it("apagar o texto libera a atualizacao", () => {
    digitar("Qual o prazo?");
    digitar("");
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("ao enviar com sucesso o campo limpa e a marca sai", async () => {
    addQuestion.mockResolvedValue({ id: "q1" });
    digitar("Qual o prazo?");
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('button[title="Enviar pergunta"]')!
        .click();
    });
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("se o envio falha o texto fica e a marca tambem", async () => {
    addQuestion.mockResolvedValue(null);
    digitar("Qual o prazo?");
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('button[title="Enviar pergunta"]')!
        .click();
    });
    expect(haOperacaoSensivel()).toBe(true);
  });

  it("sair da tela com texto digitado solta a marca", () => {
    digitar("Qual o prazo?");
    act(() => raiz.unmount());
    expect(haOperacaoSensivel()).toBe(false);
    raiz = createRoot(hospedeiro);
  });
});
