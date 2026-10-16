// @vitest-environment jsdom
// Regressão: o envio não pode apagar uma correção feita enquanto aguardava.
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

describe("AdminQAView — protege o texto durante o envio", () => {
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

  it("bloqueia o campo durante o envio e libera após falha", async () => {
    let concluir!: (sucesso: boolean) => void;
    h.addAnswer.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          concluir = resolve;
        }),
    );
    await montar();
    await abrirDialogoEDigitar("Resposta A");
    await publicarResposta();
    const campo = document.getElementById(
      "merchant-answer",
    ) as HTMLTextAreaElement;
    expect(campo.disabled).toBe(true);
    await act(async () => concluir(false));
    expect(campo.disabled).toBe(false);
    expect(campo.value).toBe("Resposta A");
    expect(toast.error).toHaveBeenCalled();
  });

  it("confere o texto ao concluir mesmo se um evento alterar o campo bloqueado", async () => {
    let concluir!: (sucesso: boolean) => void;
    h.addAnswer.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          concluir = resolve;
        }),
    );
    await montar();
    await abrirDialogoEDigitar("Resposta A");
    await publicarResposta();
    const campo = document.getElementById(
      "merchant-answer",
    ) as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(campo, "Resposta B");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => concluir(true));
    expect(document.getElementById("merchant-answer")).toBe(campo);
    expect(campo.value).toBe("Resposta B");
    expect(campo.disabled).toBe(false);
    expect(h.addAnswer).toHaveBeenCalledWith(
      { questionId: "q-1", answer: "Resposta A" },
      { silent: true },
    );
  });

  it("fecha normalmente quando a resposta enviada continua no formulário", async () => {
    h.addAnswer.mockResolvedValue(true);
    await montar();
    await abrirDialogoEDigitar("Resposta A");
    await publicarResposta();
    expect(document.getElementById("merchant-answer")).toBeNull();
  });
});
