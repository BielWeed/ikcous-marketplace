// @vitest-environment jsdom
//
// Prova forte da tela Avaliações do painel (25/11/2026, caça por mutação).
// Defeito de uma linha que os testes vizinhos deixavam passar: a lojista abre
// "Excluir esta avaliação?" com internet, a conexão cai, e ela toca em
// "Excluir". O botão de confirmar não se desliga sem internet (a lixeira que
// abre a pergunta sim), então a única trava é a de dentro da exclusão: sem ela
// o pedido saía sem rede, o aparelho ficava esperando e o aviso certo
// ("Você está offline") nunca aparecia.
// Mesmo molde do avaliacoes-prova-forte (view de verdade, hook dublado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const estado = {
    adminReviews: [] as any[],
    offline: false,
  };
  const deleteReview = vi.fn(async (..._a: unknown[]) => true);
  const toastError = vi.fn();
  const getAllReviews = vi.fn(async (..._a: unknown[]) => ({
    total: estado.adminReviews.length,
    averageRating: 4,
    globalVerifiedCount: 1,
    globalRepliedCount: 1,
    globalTotal: 3,
    globalAverageRating: 4,
    globaisDisponiveis: true,
  }));
  return { estado, deleteReview, toastError, getAllReviews };
});

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.estado.adminReviews,
    loading: false,
    erroDaListagemAdmin: null,
    getAllReviews: h.getAllReviews,
    deleteReview: h.deleteReview,
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

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.estado.offline,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: h.toastError },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

const avaliacao = {
  id: "r-1",
  productId: "p-1",
  customerName: "Cliente de Teste",
  rating: 4,
  comment: "Gostei do produto",
  helpful: 0,
  createdAt: "2026-07-07T12:00:00.000Z",
  verified: false,
  status: "publicada",
};

describe("AdminReviewsView — excluir depois de ficar sem internet", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const armazem = new Map<string, string>();

  beforeEach(() => {
    h.estado.adminReviews = [{ ...avaliacao }];
    h.estado.offline = false;
    h.deleteReview.mockClear();
    h.toastError.mockClear();
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
    armazem.clear();
    vi.unstubAllGlobals();
  });

  async function renderizar() {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView onNavigate={() => {}} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  const porRotulo = (rotulo: string) =>
    hospedeiro.querySelector<HTMLButtonElement>(
      `button[aria-label="${rotulo}"]`,
    );
  const botaoExcluirDaPergunta = () =>
    [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ].find((b) => b.textContent?.trim() === "Excluir");

  async function tocar(el: HTMLElement | null | undefined) {
    if (!el) throw new Error("elemento não encontrado");
    await act(async () => {
      el.click();
      await esperar();
    });
  }

  it("a conexão cai com a pergunta aberta: tocar em 'Excluir' não apaga nada e diz que está offline", async () => {
    await renderizar();
    await tocar(porRotulo("Excluir avaliação de Cliente de Teste"));
    expect(hospedeiro.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(botaoExcluirDaPergunta()?.disabled).toBe(false);

    // A conexão cai com a pergunta aberta; a tela relê o estado da rede.
    h.estado.offline = true;
    await renderizar();
    await tocar(botaoExcluirDaPergunta());

    expect(h.deleteReview).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(h.toastError.mock.calls[0]?.[0]).toBe("Você está offline");
    expect(h.toastError.mock.calls[0]?.[1]).toEqual({
      description:
        "Não é possível excluir avaliações sem conexão com a internet.",
    });
  });

  it("controle: com internet, o mesmo toque em 'Excluir' apaga a avaliação certa, uma vez", async () => {
    await renderizar();
    await tocar(porRotulo("Excluir avaliação de Cliente de Teste"));
    await tocar(botaoExcluirDaPergunta());

    expect(h.deleteReview.mock.calls).toEqual([["r-1"]]);
    expect(h.toastError).not.toHaveBeenCalled();
  });
});
