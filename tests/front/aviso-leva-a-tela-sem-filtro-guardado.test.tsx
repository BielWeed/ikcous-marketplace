// @vitest-environment jsdom
//
// Tocar no aviso "perguntas esperando resposta" ou "avaliação sem resposta"
// abria a tela com o filtro, a busca e a página que a lojista deixou guardados
// no aparelho, e a lista escondia o que o aviso prometia. Agora o aviso pede
// `limparFiltros` e a chegada zera o que estava guardado, com a tela já aberta
// em segundo plano (evento) ou ainda por abrir (armazenamento limpo).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { montarAvisos } from "@/utils/avisos-do-lojista";
import {
  aoChegarPorAviso,
  limparGuardadosAoChegarPorAviso,
} from "@/utils/chegada-por-aviso";

const h = vi.hoisted(() => {
  const getAllQuestions = vi.fn((..._args: unknown[]) =>
    Promise.resolve({ questions: [] as any[], total: 0 }),
  );
  const getAllReviews = vi.fn(async (..._a: unknown[]) => ({
    total: 0,
    averageRating: 0,
    globalVerifiedCount: 0,
    globalRepliedCount: 0,
    globalTotal: 0,
    globalAverageRating: 0,
    globaisDisponiveis: true,
  }));
  return { getAllQuestions, getAllReviews };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: h.getAllQuestions,
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions: () => () => {},
    getQAStats: async () => ({
      status: "ok",
      total: 6,
      pending: 2,
      answered: 4,
      rate: 67,
    }),
  }),
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: [],
    loading: false,
    erroDaListagemAdmin: null,
    getAllReviews: h.getAllReviews,
    deleteReview: vi.fn(async () => true),
    aprovarReview: vi.fn(async () => true),
    addMerchantReply: vi.fn(async () => true),
    subscribeToReviews: () => () => {},
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: 0, error: null }),
      }),
    }),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(async () => true),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

describe("avisos de pergunta e avaliação pedem a tela sem filtro guardado", () => {
  it("só esses dois avisos levam limparFiltros", () => {
    const avisos = montarAvisos({
      pedidos: [
        {
          id: "ped-1",
          customer_name: "Maria",
          total: 10,
          created_at: "2026-10-01T10:00:00Z",
        },
      ],
      perguntasPendentes: 2,
      avaliacoes: [
        {
          id: "av-1",
          product_id: "prod-1",
          rating: 2,
          nomeDoProduto: "Caneta",
          created_at: "2026-10-01T10:00:00Z",
        },
      ],
      produtos: [],
    });
    const porTipo = (tipo: string) => avisos.find((a) => a.tipo === tipo)!;
    expect(porTipo("pergunta").destino).toEqual({
      view: "admin-qa",
      limparFiltros: true,
    });
    expect(porTipo("avaliacao").destino).toEqual({
      view: "admin-reviews",
      limparFiltros: true,
    });
    expect(porTipo("pedido").destino.limparFiltros).toBeUndefined();
  });
});

describe("a chegada por aviso zera o que as telas guardam", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    h.getAllQuestions.mockClear();
    h.getAllReviews.mockClear();
    armazem.clear();
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
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
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
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
  });

  const guardar = (chave: string, valor: unknown) =>
    armazem.set(chave, JSON.stringify(valor));
  const guardado = (chave: string) => JSON.parse(armazem.get(chave) ?? "null");

  async function montarPerguntas() {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }
  async function montarAvaliacoes() {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  it("Perguntas já aberta em segundo plano: volta a Pendentes, sem busca, na página 1", async () => {
    guardar("admin_qa_filter", "all");
    guardar("admin_qa_search_query", "giz");
    guardar("admin_qa_page", 2);
    await montarPerguntas();

    await act(async () => {
      limparGuardadosAoChegarPorAviso("admin-qa");
      await esperar();
    });

    expect(guardado("admin_qa_filter")).toBe("pending");
    expect(guardado("admin_qa_search_query")).toBe("");
    expect(guardado("admin_qa_page")).toBe(0);
    const ultima = h.getAllQuestions.mock.calls.at(-1) as unknown[];
    expect(ultima[0]).toBe(0);
    expect(ultima[2]).toBe("pending");
    expect(ultima[3]).toBe("");
  });

  it("Perguntas ainda não aberta: abre já nos padrões", async () => {
    guardar("admin_qa_filter", "all");
    guardar("admin_qa_search_query", "giz");
    guardar("admin_qa_page", 2);

    limparGuardadosAoChegarPorAviso("admin-qa");
    await montarPerguntas();

    const primeira = h.getAllQuestions.mock.calls[0] as unknown[];
    expect(primeira[0]).toBe(0);
    expect(primeira[2]).toBe("pending");
    expect(primeira[3]).toBe("");
  });

  it("Avaliações já aberta em segundo plano: zera nota, moderação, busca e página", async () => {
    guardar("admin_reviews_rating_filter", 2);
    guardar("admin_reviews_status_filter", "pendente");
    guardar("admin_reviews_search_query", "caneta");
    guardar("admin_reviews_page", 3);
    await montarAvaliacoes();

    await act(async () => {
      limparGuardadosAoChegarPorAviso("admin-reviews");
      await esperar();
    });

    expect(guardado("admin_reviews_rating_filter")).toBe("all");
    expect(guardado("admin_reviews_status_filter")).toBe("todas");
    expect(guardado("admin_reviews_search_query")).toBe("");
    expect(guardado("admin_reviews_page")).toBe(0);
    const ultima = h.getAllReviews.mock.calls.at(-1) as unknown[];
    expect(ultima[0]).toBe(0);
    expect(ultima[2]).toMatchObject({
      rating: "all",
      search: "",
      status: "todas",
    });
  });

  it("Avaliações já aberta: aviso de avaliação pendente zera o resto e deixa só 'Em moderação'", async () => {
    guardar("admin_reviews_rating_filter", 2);
    guardar("admin_reviews_status_filter", "todas");
    guardar("admin_reviews_search_query", "caneta");
    guardar("admin_reviews_page", 3);
    await montarAvaliacoes();

    await act(async () => {
      limparGuardadosAoChegarPorAviso("admin-reviews", {
        soEmModeracao: true,
      });
      await esperar();
    });

    expect(guardado("admin_reviews_rating_filter")).toBe("all");
    expect(guardado("admin_reviews_status_filter")).toBe("pendente");
    expect(guardado("admin_reviews_search_query")).toBe("");
    expect(guardado("admin_reviews_page")).toBe(0);
    const ultima = h.getAllReviews.mock.calls.at(-1) as unknown[];
    expect(ultima[2]).toMatchObject({
      rating: "all",
      search: "",
      status: "pendente",
    });
  });

  it("Avaliações ainda não aberta: abre já em 'Em moderação'", async () => {
    guardar("admin_reviews_status_filter", "todas");
    guardar("admin_reviews_search_query", "caneta");

    limparGuardadosAoChegarPorAviso("admin-reviews", { soEmModeracao: true });
    await montarAvaliacoes();

    const primeira = h.getAllReviews.mock.calls[0] as unknown[];
    expect(primeira[2]).toMatchObject({ search: "", status: "pendente" });
  });

  it("Avaliações ainda não aberta, aviso comum: abre sem filtro de moderação", async () => {
    guardar("admin_reviews_status_filter", "pendente");

    limparGuardadosAoChegarPorAviso("admin-reviews");
    await montarAvaliacoes();

    const primeira = h.getAllReviews.mock.calls[0] as unknown[];
    expect(primeira[2]).toMatchObject({ status: "todas" });
  });

  it("chegar por aviso a OUTRA tela não mexe nos filtros desta", async () => {
    guardar("admin_qa_filter", "all");
    guardar("admin_qa_search_query", "giz");
    await montarPerguntas();

    await act(async () => {
      limparGuardadosAoChegarPorAviso("admin-reviews");
      await esperar();
    });

    expect(guardado("admin_qa_filter")).toBe("all");
    expect(guardado("admin_qa_search_query")).toBe("giz");
  });

  it("aoChegarPorAviso devolve a função que cancela a escuta", () => {
    const ouvinte = vi.fn();
    const parar = aoChegarPorAviso("admin-qa", ouvinte);
    limparGuardadosAoChegarPorAviso("admin-qa");
    expect(ouvinte).toHaveBeenCalledTimes(1);
    parar();
    limparGuardadosAoChegarPorAviso("admin-qa");
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });
});

describe("tocar no aviso na tela de Avisos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let AVISOS: ReturnType<typeof montarAvisos> = [];

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/hooks/useAvisosDoLojista", () => ({
      useAvisosDoLojista: () => ({
        avisos: AVISOS,
        quantidadeNoCracha: AVISOS.length,
        carregando: false,
        fontesComFalha: [],
        listasCortadas: [],
        recarregar: vi.fn(),
      }),
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
    vi.doUnmock("@/hooks/useAvisosDoLojista");
  });

  async function tocar(tipo: string) {
    const { AdminNotificationsView } = await import(
      "@/views/admin/AdminNotificationsView"
    );
    const util = await import("@/utils/chegada-por-aviso");
    const navegar = vi.fn();
    const ouvinteQA = vi.fn();
    util.aoChegarPorAviso("admin-qa", ouvinteQA);
    await act(async () => {
      raiz.render(<AdminNotificationsView onNavigate={navegar} />);
    });
    const botao = hospedeiro.querySelector<HTMLElement>(
      `[data-aviso="${tipo}"]`,
    )!;
    await act(async () => {
      botao.click();
    });
    return { navegar, ouvinteQA };
  }

  it("aviso de pergunta zera os guardados e depois navega", async () => {
    AVISOS = montarAvisos({
      pedidos: [],
      perguntasPendentes: 2,
      avaliacoes: [],
      produtos: [],
    });
    const { navegar, ouvinteQA } = await tocar("pergunta");
    expect(ouvinteQA).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("admin-qa", undefined);
  });

  it("aviso de avaliação aguardando aprovação pede só 'Em moderação' ao chegar", async () => {
    AVISOS = montarAvisos({
      pedidos: [],
      perguntasPendentes: 0,
      avaliacoes: [
        {
          id: "av-1",
          product_id: "prod-1",
          rating: 5,
          nomeDoProduto: "Caneta",
          created_at: "2026-10-01T10:00:00Z",
          status: "pendente",
        },
      ],
      produtos: [],
    });
    const util = await import("@/utils/chegada-por-aviso");
    const ouvinte = vi.fn();
    util.aoChegarPorAviso("admin-reviews", ouvinte);
    const { navegar } = await tocar("avaliacao");
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(ouvinte).toHaveBeenCalledWith({ soEmModeracao: true });
    expect(navegar).toHaveBeenCalledWith("admin-reviews", undefined);
  });

  it("aviso de avaliação já publicada sem resposta chega sem pedir moderação", async () => {
    AVISOS = montarAvisos({
      pedidos: [],
      perguntasPendentes: 0,
      avaliacoes: [
        {
          id: "av-1",
          product_id: "prod-1",
          rating: 5,
          nomeDoProduto: "Caneta",
          created_at: "2026-10-01T10:00:00Z",
          status: "publicada",
        },
      ],
      produtos: [],
    });
    const util = await import("@/utils/chegada-por-aviso");
    const ouvinte = vi.fn();
    util.aoChegarPorAviso("admin-reviews", ouvinte);
    await tocar("avaliacao");
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(ouvinte).toHaveBeenCalledWith({});
  });

  it("aviso de pedido não mexe em filtro nenhum", async () => {
    AVISOS = montarAvisos({
      pedidos: [
        {
          id: "ped-1",
          customer_name: "Maria",
          total: 10,
          created_at: "2026-10-01T10:00:00Z",
        },
      ],
      perguntasPendentes: 2,
      avaliacoes: [],
      produtos: [],
    });
    const { navegar, ouvinteQA } = await tocar("pedido");
    expect(ouvinteQA).not.toHaveBeenCalled();
    expect(navegar).toHaveBeenCalledWith("admin-orders", "ped-1");
  });
});
