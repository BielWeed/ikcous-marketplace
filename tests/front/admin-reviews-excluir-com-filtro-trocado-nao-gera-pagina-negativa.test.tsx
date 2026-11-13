// @vitest-environment jsdom
//
// Painel > Avaliações: a exclusão que demora a responder não pode empurrar a
// lista para a página -1. Cenário: 11 avaliações, a lojista abre a 2ª página
// (1 avaliação), confirma excluir, e enquanto a rede demora troca o filtro (o
// que volta para a página 0). Quando a exclusão termina, a decisão "era a
// última da página, então volta uma" olhava a página ANTIGA mas diminuía a
// NOVA: 0 virava -1 e a consulta falhava para sempre ("Tentar de novo" repetia
// a página inválida).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reviews: [] as Array<Record<string, unknown>>,
  getAllReviews: vi.fn(),
  deleteReview: vi.fn(),
  // Estável de propósito: um `vi.fn()` novo a cada render religaria a leitura
  // da lista em toda repintura e esconderia se a exclusão pediu a recarga.
  subscribeToReviews: vi.fn().mockReturnValue(() => {}),
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.reviews,
    loading: false,
    erroDaListagemAdmin: null,
    getAllReviews: h.getAllReviews,
    deleteReview: h.deleteReview,
    aprovarReview: vi.fn().mockResolvedValue(true),
    addMerchantReply: vi.fn().mockResolvedValue(true),
    subscribeToReviews: h.subscribeToReviews,
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
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: 0, error: null }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const UMA = {
  id: "r-11",
  customerName: "Ana Teste",
  productName: "Produto A",
  rating: 5,
  comment: "Ótimo",
  verified: false,
  status: "publicada",
  helpful: 0,
  createdAt: new Date("2026-08-01T10:00:00Z").toISOString(),
  merchantReply: null,
};

function leitura(total: number) {
  return {
    reviews: h.reviews,
    total,
    globalVerifiedCount: 0,
    globalRepliedCount: 0,
    globalTotal: total,
    globalAverageRating: 5,
    globaisDisponiveis: true,
  };
}

describe("AdminReviewsView — exclusão lenta com a lista mudando", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    h.reviews = [UMA];
    h.getAllReviews.mockReset().mockResolvedValue(leitura(11));
    h.deleteReview.mockReset();
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
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

  async function montarNaPagina(pagina: number) {
    armazem.set("admin_reviews_page", String(pagina));
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === rotulo,
    ) as HTMLButtonElement | undefined;
  const emModeracao = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .startsWith("Em moderação"),
    ) as HTMLButtonElement;
  const paginasPedidas = () =>
    h.getAllReviews.mock.calls.map((chamada) => chamada[0] as number);
  const paginaGuardada = () => armazem.get("admin_reviews_page");

  async function confirmarExclusaoLenta() {
    let terminar!: (ok: boolean) => void;
    h.deleteReview.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          terminar = resolve;
        }),
    );
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-label^="Excluir avaliação de "]',
        )
        ?.click();
    });
    await act(async () => {
      botao("Excluir")?.click();
    });
    return async (ok: boolean) => {
      await act(async () => {
        terminar(ok);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
  }

  it("troca de filtro durante a exclusão: a página fica em 0, nunca -1", async () => {
    await montarNaPagina(1);
    expect(paginasPedidas().at(-1)).toBe(1);
    const terminar = await confirmarExclusaoLenta();

    // Enquanto a exclusão espera, a lojista liga "Em moderação" (volta à 0).
    await act(async () => {
      emModeracao().click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(paginasPedidas().at(-1)).toBe(0);

    const consultasAntes = h.getAllReviews.mock.calls.length;

    await terminar(true);

    expect(paginasPedidas().every((p) => p >= 0)).toBe(true);
    expect(paginaGuardada()).toBe("0");
    // A exclusão aconteceu: a lista atual é relida (nova consulta na página 0),
    // senão a contagem e a lista do filtro novo ficariam como antes dela.
    expect(h.getAllReviews.mock.calls.length).toBeGreaterThan(consultasAntes);
    expect(paginasPedidas().at(-1)).toBe(0);
  });

  it("controle: sem trocar nada, excluir a única da página 2 volta para a página 1", async () => {
    await montarNaPagina(1);
    const terminar = await confirmarExclusaoLenta();
    await terminar(true);
    expect(paginaGuardada()).toBe("0");
    expect(paginasPedidas().at(-1)).toBe(0);
    expect(paginasPedidas().every((p) => p >= 0)).toBe(true);
  });

  it("controle: única avaliação da página 1 (índice 0) excluída continua na página 0 e relê a lista", async () => {
    await montarNaPagina(0);
    const antes = h.getAllReviews.mock.calls.length;
    const terminar = await confirmarExclusaoLenta();
    await terminar(true);
    expect(paginaGuardada()).toBe("0");
    expect(h.getAllReviews.mock.calls.length).toBeGreaterThan(antes);
    expect(paginasPedidas().every((p) => p >= 0)).toBe(true);
  });

  it("controle: exclusão que falha na página 2 não mexe na página", async () => {
    await montarNaPagina(1);
    const terminar = await confirmarExclusaoLenta();
    await terminar(false);
    expect(paginaGuardada()).toBe("1");
    expect(paginasPedidas().every((p) => p === 1)).toBe(true);
  });
});
