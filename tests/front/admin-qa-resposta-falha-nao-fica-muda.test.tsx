// @vitest-environment jsdom
//
// Laudo 0109 (A-1) — `handleSendAnswer` chamava `addAnswer(..., { silent: true })`
// e só tratava o caminho feliz. O hook com `silent` não toast e não lança:
// quando a resposta FALHAVA (rede, permissão, sessão vencida), a lojista
// clicava "Publicar Resposta" e NADA acontecia na tela — o diálogo ficava
// aberto, sem aviso nenhum. O conserto: a view olha o `false` e fala.
//
// Montagem: mesmo casco de admin-qa-view-erro-nao-e-fila-limpa.test.tsx —
// a view de verdade com o hook useQuestions dublado.
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

  const addAnswer = vi.fn();

  async function getQAStats(): Promise<unknown> {
    return estado.stats;
  }

  function getAllQuestions() {
    return Promise.resolve({
      questions: estado.perguntas,
      total: estado.perguntas.length,
    });
  }

  function subscribeToQuestions() {
    return () => {};
  }

  return {
    estado,
    addAnswer,
    getQAStats,
    getAllQuestions,
    subscribeToQuestions,
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

import { toast } from "sonner";

// jsdom não implementa IntersectionObserver/ResizeObserver -- LazyImage e o
// AdminKpiCarousel criam um a cada montagem. Mesmo padrão do casco citado.
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// do casco citado.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function montarPerguntaPendente() {
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

describe("AdminQAView — resposta que falha não fica muda (laudo 0109, A-1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.estado.stats = {
      status: "ok",
      total: 1,
      pending: 1,
      answered: 0,
      rate: 0,
    };
    montarPerguntaPendente();

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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function botaoResponder() {
    return Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Responder",
    );
  }

  async function abrirDialogoEDigitar(texto: string) {
    const responder = botaoResponder();
    expect(responder).toBeTruthy();
    await act(async () => {
      responder!.click();
    });
    // O diálogo (radix) monta em portal — procurar em document.body.
    const textarea = document.body.querySelector(
      "#merchant-answer",
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(textarea, texto);
      textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function publicarResposta() {
    const publicar = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Publicar Resposta"),
    );
    expect(publicar).toBeTruthy();
    await act(async () => {
      (publicar as HTMLButtonElement).click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("addAnswer resolve false: toast de erro aparece e o sucesso NÃO é cantado", async () => {
    h.addAnswer.mockResolvedValue(false);

    await montar();
    await abrirDialogoEDigitar("Sim, enviamos para todo o Brasil!");
    await publicarResposta();

    expect(h.addAnswer).toHaveBeenCalledTimes(1);
    expect(h.addAnswer).toHaveBeenCalledWith(
      { questionId: "q-1", answer: "Sim, enviamos para todo o Brasil!" },
      { silent: true },
    );

    // O ponto do A-1: falha tem de FALAR. Com o defeito, nenhum toast saía.
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível enviar a resposta. Tente de novo.",
    );
    expect(toast.success).not.toHaveBeenCalled();

    // O diálogo não se fecha como se tivesse dado certo: o texto segue aí
    // para a lojista tentar de novo.
    expect(document.body.querySelector("#merchant-answer")).toBeTruthy();
  });

  it("controle — addAnswer resolve true: sucesso cantado, nenhum erro", async () => {
    h.addAnswer.mockResolvedValue(true);

    await montar();
    await abrirDialogoEDigitar("Sim, enviamos para todo o Brasil!");
    await publicarResposta();

    expect(toast.success).toHaveBeenCalledWith("Resposta enviada com sucesso!");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
