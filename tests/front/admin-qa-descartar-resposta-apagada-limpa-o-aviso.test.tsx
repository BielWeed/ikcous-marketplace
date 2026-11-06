// @vitest-environment jsdom
//
// Perguntas do produto (painel): numa pergunta JÁ respondida, apagar todo o
// texto da resposta e descartar deixava o sinal de "formulário sujo" ligado
// no app. O texto já era vazio, então o estado `answer` não mudava no
// descarte e o efeito que avisa o painel não rodava de novo: sobrava o aviso
// falso "Alterações Não Salvas" ao sair e a atualização automática adiada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = { perguntas: [] as unknown[] };
  const getQAStats = async (): Promise<unknown> => ({
    status: "ok",
    total: 1,
    pending: 0,
    answered: 1,
    rate: 100,
  });
  const getAllQuestions = () =>
    Promise.resolve({
      questions: estado.perguntas,
      total: estado.perguntas.length,
    });
  return { estado, getQAStats, getAllQuestions };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.estado.perguntas,
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: h.getAllQuestions,
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions: () => () => {},
    getQAStats: h.getQAStats,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminQAView: descartar resposta apagada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onSetDirty = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    h.estado.perguntas = [
      {
        id: "q-1",
        userId: "cliente-1",
        productId: "prod-1",
        productName: "Produto de Teste",
        customerName: "Maria Teste",
        question: "Vocês enviam para o interior?",
        createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
        answers: [
          {
            id: "a-1",
            questionId: "q-1",
            answer: "abc",
            createdAt: new Date("2026-08-20T11:00:00Z").toISOString(),
          },
        ],
      },
    ];
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

  const botaoComTexto = (texto: string) =>
    Array.from(document.body.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === texto,
    );

  it("apagar o texto de uma resposta publicada e descartar deixa o painel sem alteração pendente", async () => {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(
        <AdminQAView
          onNavigate={() => {}}
          active={true}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      botaoComTexto("Editar resposta")[0]?.click();
    });
    const campo = document.getElementById(
      "merchant-answer",
    ) as HTMLTextAreaElement | null;
    expect(campo?.value).toBe("abc");

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, "");
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSetDirty).toHaveBeenLastCalledWith(true);

    await act(async () => {
      botaoComTexto("Descartar")[0]?.click();
    });
    expect(document.body.textContent).toContain("Descartar a resposta?");
    const confirmar = botaoComTexto("Descartar");
    await act(async () => {
      confirmar[confirmar.length - 1].click();
    });
    expect(document.getElementById("merchant-answer")).toBeNull();

    expect(onSetDirty).toHaveBeenLastCalledWith(false);
  });
});
