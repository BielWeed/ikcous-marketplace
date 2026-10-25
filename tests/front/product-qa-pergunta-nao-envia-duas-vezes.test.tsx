// @vitest-environment jsdom
//
// Caça 4 (24/10/2026), achado V3: "Enviar pergunta" não tinha trava de duplo
// envio. Dois toques seguidos (rede lenta, dedo nervoso) chamavam addQuestion
// duas vezes antes da primeira voltar -- duas perguntas idênticas públicas na
// página do produto. Agora a trava é síncrona (um useRef, que vale já no
// segundo toque do MESMO instante) e o botão fica desligado enquanto o envio
// está em andamento. Falhou o envio: a trava solta, o texto fica, e a
// cliente pode tentar de novo.
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

// Sem vi.importActual: o módulo real cria um client Supabase só de ser
// importado (mesmo comentário de product-qa-edit-prefill.test.tsx).
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

describe("ProductQA — 'Enviar pergunta' não envia duas vezes (V3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
    addQuestion.mockReset();
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
  });

  const botao = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Enviar pergunta"]',
    )!;
  const campo = () =>
    document.getElementById("qa-new-question") as HTMLInputElement;

  async function montarEDigitar(texto: string) {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });
    await act(async () => {
      digitar("qa-new-question", texto);
    });
  }

  it("dois toques no mesmo instante: addQuestion é chamado UMA vez", async () => {
    let concluir!: (q: Question | null) => void;
    addQuestion.mockReturnValue(
      new Promise<Question | null>((r) => {
        concluir = r;
      }),
    );
    await montarEDigitar("Qual o prazo para o interior?");

    // Os dois cliques acontecem antes de qualquer re-render: só uma trava
    // SÍNCRONA (ref) segura o segundo -- estado do React ainda não mudou.
    await act(async () => {
      botao().click();
      botao().click();
    });

    expect(addQuestion).toHaveBeenCalledTimes(1);

    await act(async () => {
      concluir(perguntaCriada);
    });
  });

  it("durante o envio o botão fica desligado e o campo limpa só no sucesso", async () => {
    let concluir!: (q: Question | null) => void;
    addQuestion.mockReturnValue(
      new Promise<Question | null>((r) => {
        concluir = r;
      }),
    );
    await montarEDigitar("Aceita cartão?");

    await act(async () => {
      botao().click();
    });
    expect(botao().disabled).toBe(true);
    expect(campo().value).toBe("Aceita cartão?");

    await act(async () => {
      concluir(perguntaCriada);
    });
    expect(campo().value).toBe("");
  });

  it("borda: o envio falhou (null): a trava solta, o texto fica e um novo toque reenvia", async () => {
    addQuestion
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(perguntaCriada);
    await montarEDigitar("Tem em outras cores?");

    await act(async () => {
      botao().click();
    });
    expect(addQuestion).toHaveBeenCalledTimes(1);
    expect(campo().value).toBe("Tem em outras cores?");
    expect(botao().disabled).toBe(false);

    await act(async () => {
      botao().click();
    });
    expect(addQuestion).toHaveBeenCalledTimes(2);
    expect(campo().value).toBe("");
  });
});
