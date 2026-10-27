// @vitest-environment jsdom
// Lote 222 (M6): fechar a folha com texto alterado pergunta pelo diálogo do
// app, não pela caixa nativa do navegador.
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

describe("lote 222 — AdminQAView descarta com diálogo do app", () => {
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

  it("texto alterado: abre o diálogo do app e não chama o confirm nativo", async () => {
    const nativo = vi.fn(() => true);
    vi.stubGlobal("confirm", nativo);
    await montar();
    await abrirDialogoEDigitar("Resposta A");
    const descartar = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Descartar",
    ) as HTMLButtonElement;
    await act(async () => {
      descartar.click();
    });
    expect(nativo).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Descartar a resposta?");
    // a folha segue aberta até a confirmação
    expect(document.getElementById("merchant-answer")).not.toBeNull();
    const confirmar = Array.from(
      document.body.querySelectorAll("button"),
    ).filter((b) => b.textContent?.trim() === "Descartar");
    await act(async () => {
      confirmar[confirmar.length - 1].click();
    });
    expect(document.getElementById("merchant-answer")).toBeNull();
  });

  it("'Continuar editando' mantém o texto e a folha abertos", async () => {
    await montar();
    await abrirDialogoEDigitar("Resposta A");
    const descartar = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Descartar",
    ) as HTMLButtonElement;
    await act(async () => {
      descartar.click();
    });
    const continuar = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Continuar editando",
    ) as HTMLButtonElement;
    expect(continuar).toBeTruthy();
    await act(async () => {
      continuar.click();
    });
    const campo = document.getElementById(
      "merchant-answer",
    ) as HTMLTextAreaElement | null;
    expect(campo).not.toBeNull();
    expect(campo?.value).toBe("Resposta A");
    expect(document.body.textContent).not.toContain("Descartar a resposta?");
  });
});
