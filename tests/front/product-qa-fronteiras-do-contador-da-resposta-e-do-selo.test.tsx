// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), perguntas e respostas da página do produto.
// Quatro fronteiras que a suíte não vigiava (cada uma sobrevivia à troca do
// operador ou do índice):
//  1. O contador da pergunta fica vermelho a partir de 450 de 500 (aviso de
//     que o limite chegou perto): 449 ainda é cinza, 450 já é vermelho.
//  2. A caixa de resposta de pergunta com mais de uma resposta (cópia antiga,
//     antes de a RPC virar upsert por pergunta) nasce com a resposta MAIS
//     RECENTE, a última da lista ordenada, e não a primeira: o admin vê o que
//     vai substituir de verdade.
//  3. O contador da RESPOSTA da loja fica vermelho a partir de 90% do teto.
//  4. O selo "Comprador" só aparece para quem comprou o produto
//     (`isVerified`); sem ele, nenhum selo, nem para quem não tem o campo.
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
import { TETO_DA_RESPOSTA_DA_LOJA } from "@/lib/teto-da-resposta-da-loja";

const estado = vi.hoisted(() => ({
  isAdmin: false,
  questions: [] as Question[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "cliente@exemplo.com" },
    profile: { full_name: "Cliente Teste", avatar_url: null },
    isAdmin: estado.isAdmin,
  }),
}));

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: estado.questions,
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn().mockResolvedValue(true),
    subscribeToQuestions: () => () => {},
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pergunta(extra: Partial<Question> = {}): Question {
  return {
    id: "q-1",
    userId: "u-2",
    productId: "prod-1",
    customerName: "Outro Cliente",
    question: "Tem em outras cores?",
    createdAt: "2026-08-01T09:00:00Z",
    answers: [],
    ...extra,
  };
}

// Mesmo padrão dos vizinhos: o setter nativo faz o onChange controlado ver o
// valor novo.
function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    el.tagName === "TEXTAREA"
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ProductQA — fronteiras de contador, resposta recente e selo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
    estado.isAdmin = false;
    estado.questions = [];
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

  const montar = async () => {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });
  };

  const contadorDaPergunta = () =>
    document.getElementById("qa-question-count") as HTMLElement;

  it("contador da pergunta: 449 caracteres seguem cinza, 450 ficam vermelhos, 500 também", async () => {
    await montar();

    await act(async () => digitar("qa-new-question", "a".repeat(449)));
    expect(contadorDaPergunta().textContent).toBe("449/500 caracteres");
    expect(contadorDaPergunta().classList.contains("text-red-600")).toBe(false);

    await act(async () => digitar("qa-new-question", "a".repeat(450)));
    expect(contadorDaPergunta().classList.contains("text-red-600")).toBe(true);

    await act(async () => digitar("qa-new-question", "a".repeat(500)));
    expect(contadorDaPergunta().classList.contains("text-red-600")).toBe(true);
  });

  it("pergunta com duas respostas: a caixa abre com a MAIS RECENTE (a última da lista)", async () => {
    estado.isAdmin = true;
    estado.questions = [
      pergunta({
        answers: [
          {
            id: "a-velha",
            questionId: "q-1",
            answer: "Resposta antiga.",
            createdAt: "2026-08-01T10:00:00Z",
          },
          {
            id: "a-nova",
            questionId: "q-1",
            answer: "Resposta mais recente.",
            createdAt: "2026-08-03T10:00:00Z",
          },
        ],
      }),
    ];
    await montar();

    const abrir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Editar Resposta"),
    );
    await act(async () => {
      abrir?.click();
    });

    const caixa =
      hospedeiro.querySelector<HTMLTextAreaElement>("#qa-reply-q-1");
    expect(caixa?.value).toBe("Resposta mais recente.");
  });

  it("contador da resposta da loja: vermelho só a partir de 90% do teto", async () => {
    estado.isAdmin = true;
    estado.questions = [pergunta()];
    await montar();
    const abrir = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Responder Pergunta"),
    );
    await act(async () => {
      abrir?.click();
    });
    const limite = Math.ceil(TETO_DA_RESPOSTA_DA_LOJA * 0.9);
    const contador = () =>
      document.getElementById("qa-reply-count-q-1") as HTMLElement;

    await act(async () => digitar("qa-reply-q-1", "a".repeat(limite - 1)));
    expect(contador().classList.contains("text-red-600")).toBe(false);

    await act(async () => digitar("qa-reply-q-1", "a".repeat(limite)));
    expect(contador().classList.contains("text-red-600")).toBe(true);
  });

  it("cliente comum não vê botão de responder nem de editar resposta (só o admin)", async () => {
    estado.isAdmin = false;
    estado.questions = [
      pergunta({ id: "q-sem-resposta" }),
      pergunta({
        id: "q-respondida",
        answers: [
          {
            id: "a-1",
            questionId: "q-respondida",
            answer: "Temos sim.",
            createdAt: "2026-08-01T10:00:00Z",
          },
        ],
      }),
    ];
    await montar();

    const textos = [...hospedeiro.querySelectorAll("button")].map(
      (b) => b.textContent ?? "",
    );

    expect(textos.some((t) => t.includes("Responder Pergunta"))).toBe(false);
    expect(textos.some((t) => t.includes("Editar Resposta"))).toBe(false);
    expect(hospedeiro.querySelector("textarea")).toBeNull();
    // A resposta já publicada continua visível para todos.
    expect(hospedeiro.textContent).toContain("Temos sim.");
  });

  it("selo 'Comprador': aparece só com isVerified verdadeiro", async () => {
    estado.questions = [
      pergunta({ id: "q-comprou", isVerified: true }),
      pergunta({ id: "q-nao-comprou", isVerified: false }),
      pergunta({ id: "q-sem-campo", isVerified: undefined }),
    ];
    await montar();

    const selos = [...hospedeiro.querySelectorAll("span")].filter(
      (s) => s.textContent?.trim() === "Comprador",
    );

    expect(selos).toHaveLength(1);
  });
});
