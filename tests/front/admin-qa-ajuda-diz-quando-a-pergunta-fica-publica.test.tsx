// @vitest-environment jsdom
//
// A ajuda da tela de Perguntas dizia que a pergunta "se torna visível
// publicamente" depois que a lojista responde. No banco é o contrário: a
// vitrine (`vw_questions_public`, migration 20261110000000) lê `questions` sem
// filtro de resposta, então a pergunta já está na página do produto no instante
// em que o cliente a envia (a 20261396100000 diz: "aparece na hora, sem
// moderação"). O que a resposta acrescenta é a resposta, junto da pergunta.
// Montagem: mesmo casco de admin-qa-a-promessa-do-formulario-e-verdadeira.test.tsx.
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

describe("AdminQAView — a ajuda diz quando a pergunta fica pública", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function abrirAAjuda() {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const ajuda = document.body.querySelector<HTMLButtonElement>(
      'button[title="Guia das perguntas e ajuda"]',
    );
    expect(ajuda).toBeTruthy();
    await act(async () => {
      ajuda!.click();
    });
    expect(document.body.textContent).toContain("Como funcionam as perguntas");
  }

  it("não diz que a pergunta só fica pública depois da resposta", async () => {
    await abrirAAjuda();
    expect(document.body.textContent).not.toContain("se torna visível");
  });

  it("diz que a pergunta já é pública ao ser enviada e que a resposta aparece junto dela", async () => {
    await abrirAAjuda();
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("já aparece para todos");
    expect(texto).toContain("assim que o cliente a envia");
    expect(texto).toContain("sua resposta aparece junto dela");
  });
});
