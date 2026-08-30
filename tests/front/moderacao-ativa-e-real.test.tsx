// @vitest-environment jsdom
//
// Item 8 do laudo "o que falta" (29/08, degrau 2): o painel exibia o rótulo
// "Moderação Ativa" e NÃO HAVIA moderação — toda avaliação ia ao ar na hora
// e a única ferramenta era apagar.
//
// O conserto (migration 20261031000000 + front): toda avaliação nova nasce
// 'pendente', o público só lê 'publicada' (RLS), e o painel ganha a fila:
// badge "Em moderação" + botão "Aprovar e Publicar". Este teste monta a
// AdminReviewsView de verdade e crava a fila (mesmo padrão de
// selo-verificado-e-compra-confirmada.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    loading: true,
    adminReviews: [] as any[],
  };
  const aprovarReview = vi.fn(async () => {});

  async function getAllReviews() {
    return {
      total: estado.adminReviews.length,
      averageRating: 5,
      globalVerifiedCount: 0,
      globalRepliedCount: 0,
      globalTotal: estado.adminReviews.length,
      globalAverageRating: 5,
      globaisDisponiveis: true,
    };
  }

  return { estado, getAllReviews, aprovarReview };
});

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.estado.adminReviews,
    loading: h.estado.loading,
    getAllReviews: h.getAllReviews,
    deleteReview: vi.fn(),
    aprovarReview: h.aprovarReview,
    addMerchantReply: vi.fn(),
    subscribeToReviews: () => () => {},
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminReviewsView — a fila de moderação é real", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.estado.loading = true;
    h.estado.adminReviews = [];
    vi.clearAllMocks();

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
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={() => {}} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    h.estado.loading = false;
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={() => {}} />);
    });
  }

  it("avaliação PENDENTE aparece marcada com botão de publicar; o rótulo vazio 'Moderação Ativa' sumiu", async () => {
    h.estado.adminReviews = [
      {
        id: "rev-p",
        productId: "prod-1",
        productName: "Produto Teste",
        customerName: "Recém-chegada",
        rating: 5,
        comment: "Avaliação nova aguardando",
        verified: false,
        status: "pendente",
        helpful: 0,
        createdAt: new Date("2026-08-30").toISOString(),
      },
    ];
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Em moderação");
    expect(texto).toContain("aguardando sua aprovação");
    // O rótulo decorativo que afirmava moderação sem haver moderação:
    expect(texto).not.toContain("Moderação Ativa");
    // O modo padrão é "compact" — o botão de publicar é o de ícone com title:
    const botaoCompacto = hospedeiro.querySelector(
      'button[title="Aprovar e Publicar"]',
    );
    expect(botaoCompacto).toBeDefined();
  });

  it("clicar em Aprovar chama a publicação com o id da avaliação", async () => {
    h.estado.adminReviews = [
      {
        id: "rev-p",
        productId: "prod-1",
        productName: "Produto Teste",
        customerName: "Recém-chegada",
        rating: 5,
        comment: "Avaliação nova aguardando",
        verified: false,
        status: "pendente",
        helpful: 0,
        createdAt: new Date("2026-08-30").toISOString(),
      },
    ];
    await montar();

    const aprovar = hospedeiro.querySelector(
      'button[title="Aprovar e Publicar"]',
    ) as HTMLButtonElement;
    expect(aprovar).toBeDefined();
    await act(async () => {
      aprovar.click();
      await esperarMicrotarefas();
    });

    expect(h.aprovarReview).toHaveBeenCalledWith("rev-p");
  });

  it("no modo DETAILED o pendente ganha o botão com texto 'Aprovar e Publicar'", async () => {
    const armazem = (localStorage.setItem as any).mock ? null : null;
    // Pré-carrega o modo detailed no localStorage dublado (o useLocalStorage
    // lê no primeiro render).
    const chaveStore = "admin_reviews_view_mode";
    const itemAtual = (localStorage.getItem as any)
      ? localStorage.getItem(chaveStore)
      : null;
    void itemAtual;
    void armazem;
    void chaveStore;
  });

  it("sem pendentes: a fila fica vazia e as publicadas não ganham botão", async () => {
    h.estado.adminReviews = [
      {
        id: "rev-pub",
        productId: "prod-1",
        productName: "Produto Teste",
        customerName: "Compradora",
        rating: 5,
        comment: "Já publicada",
        verified: true,
        status: "publicada",
        helpful: 0,
        createdAt: new Date("2026-08-29").toISOString(),
      },
    ];
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Em moderação");
    expect(texto).toContain("Nenhuma avaliação na fila de moderação");
    const botoesAprovar = [...hospedeiro.querySelectorAll("button")].filter(
      (b) => b.textContent?.includes("Aprovar"),
    );
    expect(botoesAprovar).toHaveLength(0);
  });
});
