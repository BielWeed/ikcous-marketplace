// @vitest-environment jsdom
//
// A caixa de resposta do painel de perguntas dizia "Notificar Cliente", mas a
// resposta só era gravada: a cliente nunca era avisada. Com a migration
// 20261240000000 a resposta cria um aviso no SINO da cliente dentro do app (sem
// push, que exige a edge function) — e o texto passa a dizer exatamente isso.
// Montagem: mesmo casco de admin-qa-resposta-falha-nao-fica-muda.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    stats: {
      status: "ok",
      total: 1,
      pending: 1,
      answered: 0,
      rate: 0,
    } as unknown,
    perguntas: [] as unknown[],
  };
  return {
    estado,
    addAnswer: vi.fn(),
    getQAStats: async (): Promise<unknown> => estado.stats,
    getAllQuestions: () =>
      Promise.resolve({
        questions: estado.perguntas,
        total: estado.perguntas.length,
      }),
    subscribeToQuestions: () => () => {},
  };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.estado.perguntas,
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: h.getAllQuestions,
    addQuestion: vi.fn(),
    addAnswer: h.addAnswer,
    deleteQuestion: vi.fn(),
    subscribeToQuestions: h.subscribeToQuestions,
    getQAStats: h.getQAStats,
  }),
}));

// o hook devolve "está OFFLINE?" (false = com rede): mesmo dublê dos testes irmãos.
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminQAView — o que a caixa de resposta promete é o que acontece", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.estado.perguntas = [
      {
        id: "q-1",
        userId: "cliente-1",
        productId: "prod-1",
        productName: "Produto de Teste",
        customerName: "Maria Teste",
        question: "Tem no M?",
        createdAt: new Date("2026-10-14T10:00:00Z").toISOString(),
        answers: [],
      },
    ];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
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

  async function abrirADialogoDeResposta() {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const responder = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Responder",
    );
    expect(responder).toBeTruthy();
    await act(async () => {
      responder!.click();
    });
    expect(document.body.querySelector("#merchant-answer")).toBeTruthy();
  }

  it("a caixa de resposta não promete 'Notificar Cliente' (push que nunca saiu)", async () => {
    await abrirADialogoDeResposta();
    expect(document.body.textContent).not.toContain("Notificar Cliente");
  });

  it("a caixa de resposta diz o que acontece de verdade: a cliente é avisada no app", async () => {
    await abrirADialogoDeResposta();
    expect(document.body.textContent).toContain("Avisa a cliente no app");
  });
});
