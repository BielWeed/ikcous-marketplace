// @vitest-environment jsdom
//
// Achado 3 do lote 1 (caça-defeitos): a lojista clica na lixeira de uma
// dúvida, confirma, e lê o verde "Pergunta excluída" — mesmo quando a
// exclusão FALHOU (rede, permissão, sessão vencida). `deleteQuestion`
// (useQuestions.ts) tinha `catch` que só fazia `console.error` e, com
// `{ silent: true }`, suprimia também o `toast.error`; devolvia `undefined`
// tanto no sucesso quanto na falha. A view chamava
// `await deleteQuestion(id, { silent: true })` e comemorava na linha
// seguinte, sem checar nada.
//
// O molde é `handleSendAnswer` (linha 317-326 de AdminQAView.tsx), que já
// testa `if (success)` porque `addAnswer` devolve booleano — aqui
// `deleteQuestion` passa a devolver booleano também, e a view testa antes
// de comemorar.
//
// Mesmo padrão de mount de admin-qa-view-erro-nao-e-fila-limpa.test.tsx:
// createRoot + act, sem @testing-library/react (não instalado neste
// projeto), useQuestions dublado com estado mutável via vi.hoisted.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    perguntas: [] as unknown[],
    // Resultado que o dublê de deleteQuestion devolve — controlado por teste.
    deleteQuestionResultado: true as boolean,
  };

  const deleteQuestion = vi.fn(async () => estado.deleteQuestionResultado);

  function getAllQuestions() {
    return Promise.resolve({
      questions: estado.perguntas,
      total: estado.perguntas.length,
    });
  }

  function subscribeToQuestions() {
    return () => {};
  }

  async function getQAStats(): Promise<unknown> {
    return { status: "ok", total: 0, pending: 0, answered: 0, rate: 0 };
  }

  return {
    estado,
    deleteQuestion,
    getAllQuestions,
    subscribeToQuestions,
    getQAStats,
  };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.estado.perguntas,
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: h.getAllQuestions,
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: h.deleteQuestion,
    subscribeToQuestions: h.subscribeToQuestions,
    getQAStats: h.getQAStats,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    loading: vi.fn(),
  },
}));

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// admin-qa-view-erro-nao-e-fila-limpa.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function montarPergunta() {
  h.estado.perguntas = [
    {
      id: "q-1",
      userId: "cliente-1",
      productId: "prod-1",
      productName: "Produto de Teste",
      customerName: "Maria Teste",
      question: "Vocês enviam para o interior?",
      createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
      answers: [],
    },
  ];
}

describe("AdminQAView — 'Pergunta excluída' só comemora se excluiu de verdade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.estado.perguntas = [];
    h.estado.deleteQuestionResultado = true;
    h.deleteQuestion.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();

    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");

    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function clicarExcluirEConfirmar() {
    const botaoLixeira = hospedeiro.querySelector(
      'button[title="Excluir Pergunta"]',
    ) as HTMLButtonElement | null;
    expect(botaoLixeira).toBeTruthy();
    botaoLixeira!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function clicarSim() {
    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoSim = botoes.find((b) => b.textContent?.trim() === "Sim");
    expect(botaoSim).toBeTruthy();
    botaoSim!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("exclusão que FALHA: não mostra 'Pergunta excluída'", async () => {
    montarPergunta();
    h.estado.deleteQuestionResultado = false;

    await montar();

    await act(async () => {
      clicarExcluirEConfirmar();
    });
    await act(async () => {
      clicarSim();
      await esperarMicrotarefas();
    });

    expect(h.deleteQuestion).toHaveBeenCalledWith("q-1", { silent: true });
    expect(toastSuccess).not.toHaveBeenCalledWith("Pergunta excluída");
  });

  it("controle positivo: exclusão que dá certo CONTINUA mostrando 'Pergunta excluída'", async () => {
    montarPergunta();
    h.estado.deleteQuestionResultado = true;

    await montar();

    await act(async () => {
      clicarExcluirEConfirmar();
    });
    await act(async () => {
      clicarSim();
      await esperarMicrotarefas();
    });

    expect(h.deleteQuestion).toHaveBeenCalledWith("q-1", { silent: true });
    expect(toastSuccess).toHaveBeenCalledWith("Pergunta excluída");
  });

  // A revisao apontou que parar de comemorar era metade: a lojista clicava
  // "Sim", nada acontecia, NENHUM aviso aparecia e o dialogo ficava aberto.
  // Calar tambem e mentir -- ela nao tinha como saber se falhou ou se o
  // clique nao pegou.
  it("exclusao que FALHA avisa a lojista, em vez de so ficar em silencio", async () => {
    montarPergunta();
    h.estado.deleteQuestionResultado = false;

    await montar();

    await act(async () => {
      clicarExcluirEConfirmar();
    });
    await act(async () => {
      clicarSim();
      await esperarMicrotarefas();
    });

    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Nao foi possivel excluir"),
    );
  });
});
