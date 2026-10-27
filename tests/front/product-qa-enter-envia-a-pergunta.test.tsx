// @vitest-environment jsdom
//
// Lote 221: no celular o "Enviar/Ir" do teclado não enviava a pergunta ao
// vendedor (campo solto, sem formulário). Agora o campo vive num <form>: o
// Enter do teclado dispara o envio, o teclado mostra "Enviar", vazio não
// envia e dois toques seguidos enviam uma vez só. Os textos miúdos da seção
// (8, 9 e 10 px) subiram para 12 px.
import { readFileSync } from "node:fs";
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "cliente-1", email: "cliente@ikcous.com" },
    profile: { full_name: "Cliente", avatar_url: null },
    isAdmin: false,
  }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
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
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const perguntaCriada: Question = {
  id: "q-nova",
  userId: "cliente-1",
  productId: "prod-1",
  customerName: "Cliente",
  question: "Qual o prazo?",
  createdAt: "2026-10-01T10:00:00Z",
  answers: [],
};

describe("ProductQA — Enter do teclado envia a pergunta (lote 221)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(async () => {
    addQuestion.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  const campo = () =>
    document.getElementById("qa-new-question") as HTMLInputElement;
  const formulario = () => campo().closest("form");

  it("o campo está num formulário e o teclado mostra 'Enviar'", () => {
    expect(formulario()).not.toBeNull();
    expect(campo().getAttribute("enterkeyhint")).toBe("send");
    const botao = formulario()!.querySelector<HTMLButtonElement>(
      'button[aria-label="Enviar pergunta"]',
    )!;
    expect(botao.type).toBe("submit");
  });

  it("Enter (envio do formulário) manda a pergunta e limpa o campo", async () => {
    addQuestion.mockResolvedValue(perguntaCriada);
    await act(async () => {
      digitar("qa-new-question", "Qual o prazo para o interior?");
    });
    await act(async () => {
      formulario()!.requestSubmit();
    });
    expect(addQuestion).toHaveBeenCalledTimes(1);
    expect(addQuestion).toHaveBeenCalledWith({
      productId: "prod-1",
      question: "Qual o prazo para o interior?",
    });
    expect(campo().value).toBe("");
  });

  it("campo vazio ou só espaços: Enter não envia nada", async () => {
    await act(async () => {
      formulario()!.requestSubmit();
    });
    await act(async () => {
      digitar("qa-new-question", "   ");
    });
    await act(async () => {
      formulario()!.requestSubmit();
    });
    expect(addQuestion).not.toHaveBeenCalled();
  });

  it("dois Enter no mesmo instante enviam uma vez só", async () => {
    let concluir!: (q: Question | null) => void;
    addQuestion.mockReturnValue(
      new Promise<Question | null>((r) => {
        concluir = r;
      }),
    );
    await act(async () => {
      digitar("qa-new-question", "Aceita cartão?");
    });
    await act(async () => {
      formulario()!.requestSubmit();
      formulario()!.requestSubmit();
    });
    expect(addQuestion).toHaveBeenCalledTimes(1);
    await act(async () => {
      concluir(perguntaCriada);
    });
  });

  it("a seção não usa mais letras de 8, 9 ou 10 px", () => {
    const fonte = readFileSync(
      "src/components/ui/custom/ProductQA.tsx",
      "utf8",
    );
    expect(fonte).not.toMatch(/text-\[(7|8|9|10)px\]/);
  });
});
