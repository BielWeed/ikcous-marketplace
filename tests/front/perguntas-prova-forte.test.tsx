// @vitest-environment jsdom
//
// Prova forte da tela Perguntas do painel (25/11/2026, caça por mutação).
// Dois defeitos de uma linha passavam nos testes vizinhos:
//   - a resposta publicada ia COM os espaços e quebras das pontas (os testes
//     digitavam textos sem sobra, então nunca viam a diferença);
//   - ao editar uma pergunta que já tem mais de uma resposta, o campo abria com
//     a primeira em vez da mais recente (os testes só usavam uma resposta).
// Mesmo molde do admin-qa-envio-preserva-texto. Só fixtures inventadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    perguntas: [] as unknown[],
  };
  const addAnswer = vi.fn();
  return { estado, addAnswer };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.estado.perguntas,
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: () =>
      Promise.resolve({
        questions: h.estado.perguntas,
        total: h.estado.perguntas.length,
      }),
    addQuestion: vi.fn(),
    addAnswer: h.addAnswer,
    deleteQuestion: vi.fn(),
    subscribeToQuestions: () => () => {},
    getQAStats: async () => ({
      status: "ok",
      total: 1,
      pending: 1,
      answered: 0,
      rate: 0,
    }),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pergunta = (answers: unknown[]) => ({
  id: "q-1",
  userId: "cliente-1",
  productId: "prod-1",
  productName: "Produto de Teste",
  customerName: "Maria Teste",
  question: "Vocês enviam para o interior?",
  createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
  answers,
});

describe("AdminQAView — prova forte", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.estado.perguntas = [];
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const botaoPorRotulo = (rotulo: string) =>
    document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${rotulo}"]`,
    );
  const campo = () =>
    document.body.querySelector<HTMLTextAreaElement>("#merchant-answer");

  async function abrir(rotulo: string) {
    const botao = botaoPorRotulo(rotulo);
    if (!botao) throw new Error(`botão "${rotulo}" não está na tela`);
    await act(async () => {
      botao.click();
    });
  }

  it("a resposta publicada vai sem os espaços e quebras de linha das pontas", async () => {
    h.estado.perguntas = [pergunta([])];
    h.addAnswer.mockResolvedValue(true);
    await montar();
    await abrir("Responder a Maria Teste");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(campo(), "  Sim, enviamos para todo o Brasil.  \n");
      campo()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const publicar = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Publicar resposta"),
    );
    await act(async () => {
      publicar?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.addAnswer).toHaveBeenCalledTimes(1);
    expect(h.addAnswer.mock.calls[0]?.[0]).toEqual({
      questionId: "q-1",
      answer: "Sim, enviamos para todo o Brasil.",
    });
  });

  it("editar uma pergunta com duas respostas abre o campo com a MAIS RECENTE (a última da lista)", async () => {
    h.estado.perguntas = [
      pergunta([
        {
          id: "a-1",
          answer: "Resposta ANTIGA da loja",
          createdAt: new Date("2026-08-21T10:00:00Z").toISOString(),
        },
        {
          id: "a-2",
          answer: "Resposta NOVA da loja",
          createdAt: new Date("2026-08-25T10:00:00Z").toISOString(),
        },
      ]),
    ];
    await montar();
    await abrir("Editar resposta a Maria Teste");

    expect(campo()?.value).toBe("Resposta NOVA da loja");
  });
});
