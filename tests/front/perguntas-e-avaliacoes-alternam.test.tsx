// @vitest-environment jsdom
//
// Painel simples, tarefa C4: Perguntas e Avaliações são duas telas atrás de
// UMA porta ("Perguntas e avaliações", em Clientes). O que leva de uma à
// outra é o alternador "Perguntas | Avaliações", logo abaixo do cabeçalho de
// cada tela:
//   - em Perguntas, clicar "Avaliações" chama onNavigate("admin-reviews");
//   - em Avaliações, clicar "Perguntas" chama onNavigate("admin-qa");
//   - a tela em que se está leva aria-current="page" e clicar nela não navega;
//   - o título da tela vem de NOMES_DO_PAINEL.
//
// Monta as duas views de verdade (createRoot + act, sem @testing-library), com
// os hooks de dados dublados — mesmo casco de admin-qa-view-erro-nao-e-fila-limpa
// e admin-reviews-fila-vem-do-banco.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOMES_DO_PAINEL } from "../../src/config/nomes-do-painel";

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: () => Promise.resolve({ questions: [], total: 0 }),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions: () => () => {},
    getQAStats: () =>
      Promise.resolve({
        status: "ok",
        total: 0,
        pending: 0,
        answered: 0,
        rate: 0,
      }),
  }),
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: [],
    loading: false,
    getAllReviews: vi.fn().mockResolvedValue({
      reviews: [],
      total: 0,
      averageRating: 0,
      globalVerifiedCount: 0,
      globalRepliedCount: 0,
    }),
    deleteReview: vi.fn().mockResolvedValue(true),
    aprovarReview: vi.fn().mockResolvedValue(true),
    addMerchantReply: vi.fn().mockResolvedValue(true),
    subscribeToReviews: vi.fn().mockReturnValue(() => {}),
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
    })),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("alternador Perguntas | Avaliações", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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
  });

  async function montarPerguntas(onNavigate: (view: string) => void) {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function montarAvaliacoes(onNavigate: (view: string) => void) {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function alternador(): HTMLElement {
    const nav = hospedeiro.querySelector<HTMLElement>(
      'nav[aria-label="Telas desta seção"]',
    );
    if (!nav)
      throw new Error("a tela não tem o alternador Perguntas|Avaliações");
    return nav;
  }

  function botaoDoAlternador(nome: string): HTMLButtonElement {
    const achado = Array.from(alternador().querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === nome,
    );
    if (!achado) throw new Error(`o alternador não tem o botão "${nome}"`);
    return achado;
  }

  it("Perguntas: o alternador tem as duas telas, marca Perguntas e 'Avaliações' navega para admin-reviews", async () => {
    const onNavigate = vi.fn();
    await montarPerguntas(onNavigate);

    expect(
      Array.from(alternador().querySelectorAll("button")).map((b) =>
        b.textContent?.trim(),
      ),
    ).toEqual(["Perguntas", "Avaliações"]);
    expect(botaoDoAlternador("Perguntas").getAttribute("aria-current")).toBe(
      "page",
    );
    expect(botaoDoAlternador("Avaliações").hasAttribute("aria-current")).toBe(
      false,
    );

    act(() => {
      botaoDoAlternador("Avaliações").click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("admin-reviews");
  });

  it("Avaliações: marca Avaliações e 'Perguntas' navega para admin-qa", async () => {
    const onNavigate = vi.fn();
    await montarAvaliacoes(onNavigate);

    expect(botaoDoAlternador("Avaliações").getAttribute("aria-current")).toBe(
      "page",
    );
    expect(botaoDoAlternador("Perguntas").hasAttribute("aria-current")).toBe(
      false,
    );

    act(() => {
      botaoDoAlternador("Perguntas").click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("admin-qa");
  });

  it("clicar na tela em que já está não navega", async () => {
    const onNavigate = vi.fn();
    await montarPerguntas(onNavigate);
    act(() => {
      botaoDoAlternador("Perguntas").click();
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("o título de cada tela é o nome de NOMES_DO_PAINEL", async () => {
    await montarPerguntas(vi.fn());
    expect(hospedeiro.querySelector("h1")?.textContent).toContain(
      NOMES_DO_PAINEL["admin-qa"],
    );
    act(() => {
      raiz.render(<div />);
    });
    await montarAvaliacoes(vi.fn());
    expect(hospedeiro.querySelector("h1")?.textContent).toContain(
      NOMES_DO_PAINEL["admin-reviews"],
    );
  });
});
