// @vitest-environment jsdom
//
// Achado que bloqueou a revisão da Trilha 3 (issue #100): o ProductQA (caixa
// de resposta na PÁGINA DO PRODUTO, o segundo chamador de addAnswer além do
// modal do painel admin) nascia SEMPRE vazio, mesmo em pergunta já
// respondida. Com a migration 20260812000000 trocando a RPC para
// upsert-por-question_id, digitar ali e enviar SOBRESCREVE a resposta
// anterior sem o admin ver o que está perdendo.
//
// O conserto alinha o ProductQA ao que o modal do painel (AdminQAView) já
// fazia: ao abrir a caixa de resposta, se a pergunta já tem resposta, o
// campo nasce PRÉ-PREENCHIDO com o texto atual e o rótulo do botão vira
// "Editar Resposta" -- o admin vê o que está prestes a substituir antes de
// substituir. Pergunta sem resposta continua nascendo vazia, rotulada
// "Responder Pergunta".
//
// Render de verdade (react-dom/client + jsdom), não dublê de React: o que
// este teste prova é a árvore renderizada reagindo a um clique real.
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

import type { Answer, Question } from "@/hooks/useQuestions";

const addAnswer = vi.fn().mockResolvedValue(true);
const getQuestionsByProduct = vi.fn();
const subscribeToQuestions = vi.fn(() => () => {});

const respostaAntiga: Answer = {
  id: "answer-1",
  questionId: "question-respondida",
  answer: "Sim, temos em 3 cores. Frete grátis acima de R$200.",
  createdAt: "2026-08-01T10:00:00Z",
};

const perguntaRespondida: Question = {
  id: "question-respondida",
  userId: "user-1",
  productId: "prod-1",
  customerName: "Cliente Teste",
  question: "Tem em outras cores?",
  createdAt: "2026-08-01T09:00:00Z",
  answers: [respostaAntiga],
};

const perguntaSemResposta: Question = {
  id: "question-sem-resposta",
  userId: "user-2",
  productId: "prod-1",
  customerName: "Outro Cliente",
  question: "Qual o prazo de entrega?",
  createdAt: "2026-08-02T09:00:00Z",
  answers: [],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1", email: "admin@ikcous.com" },
    profile: { full_name: "Admin", avatar_url: null },
    isAdmin: true,
  }),
}));

// Sem vi.importActual: o módulo real importa @/lib/supabase, que cria um
// client de verdade (Web Worker, indisponível no jsdom) só de ser importado.
// Este teste não precisa do hook real -- só do formato que ele expõe.
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [perguntaRespondida, perguntaSemResposta],
    loading: false,
    getQuestionsByProduct,
    addQuestion: vi.fn(),
    addAnswer,
    subscribeToQuestions,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão de
// checkout-view-flag-off.test.tsx: sem ela o React reclama "not configured
// to support act(...)" em todo render, mesmo dentro de act().
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function localizarBotaoPorTexto(texto: string, dentroDe: HTMLElement) {
  return [...dentroDe.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

// Mesmo padrão de tests/front/checkout-guest-cep.test.tsx: dispara o setter
// nativo do input (não a propriedade do React) para que o onChange
// controlado do componente veja o novo valor.
function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ProductQA — caixa de resposta na página do produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // O primeiro import dinâmico de ProductQA transforma toda a árvore de
  // dependências dele (Avatar do Radix, ícones do lucide-react, date-fns +
  // locale ptBR) e mediu de 3,3s a 4,5s neste repositório -- perto demais do
  // testTimeout padrão (5000ms) para pagar esse custo DENTRO de um `it`.
  // Importar uma vez aqui, fora do orçamento por teste, paga o custo só uma
  // vez e deixa os dois `it`s abaixo rápidos (o módulo já está no cache).
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
    addAnswer.mockClear();
    getQuestionsByProduct.mockClear();
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

  it("pergunta já respondida: abre pré-preenchida e rotulada como edição", async () => {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });

    const botaoAbrir = localizarBotaoPorTexto("Editar Resposta", hospedeiro);
    expect(botaoAbrir).toBeDefined();
    // Falha fechada: a MESMA pergunta não pode oferecer os dois rótulos --
    // a outra pergunta da fixture (sem resposta) continua com "Responder
    // Pergunta", e é por isso que a asserção não é sobre a página inteira.
    expect(botaoAbrir!.textContent).not.toContain("Responder Pergunta");

    await act(async () => {
      botaoAbrir!.click();
    });

    const campo = document.getElementById(
      "qa-reply-question-respondida",
    ) as HTMLInputElement;
    expect(campo).toBeDefined();
    expect(campo.value).toBe(respostaAntiga.answer);
  });

  it("pergunta sem resposta: abre vazia com o rótulo atual", async () => {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });

    const botaoAbrir = localizarBotaoPorTexto("Responder Pergunta", hospedeiro);
    expect(botaoAbrir).toBeDefined();

    await act(async () => {
      botaoAbrir!.click();
    });

    const campo = document.getElementById(
      "qa-reply-question-sem-resposta",
    ) as HTMLInputElement;
    expect(campo).toBeDefined();
    expect(campo.value).toBe("");
  });

  // Achado da revisão da Trilha 3 (Correção 3): os dois testes acima só
  // provam o valor NO INSTANTE em que a caixa abre. Se o pré-preenchimento
  // virasse um valor derivado (ou um useEffect disparado a cada render em
  // vez de só no clique que abre a caixa), os dois continuariam verdes e o
  // admin perderia a capacidade de apagar o texto do campo -- a cada
  // re-render o valor voltaria a ser a resposta antiga. Este teste força um
  // segundo render da árvore inteira DEPOIS de digitar, sem tocar em
  // replyingTo, e prova que o que foi digitado sobrevive.
  it("digitar e forçar um re-render não apaga o que o admin escreveu", async () => {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });

    const botaoAbrir = localizarBotaoPorTexto("Editar Resposta", hospedeiro);
    await act(async () => {
      botaoAbrir!.click();
    });

    const campoId = "qa-reply-question-respondida";
    act(() => {
      digitar(campoId, "Resposta nova, digitada por cima da antiga.");
    });

    // Re-render da mesma árvore, com as mesmas props -- é exatamente o que
    // um valor derivado ou um useEffect mal guardado recalcularia.
    await act(async () => {
      raiz.render(<ProductQA productId="prod-1" />);
    });

    const campo = document.getElementById(campoId) as HTMLInputElement;
    expect(campo.value).toBe("Resposta nova, digitada por cima da antiga.");
  });
});
