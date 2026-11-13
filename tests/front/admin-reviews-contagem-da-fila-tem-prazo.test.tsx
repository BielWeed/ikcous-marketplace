// @vitest-environment jsdom
//
// A contagem da fila de moderação (cartão "para aprovar") não pode pendurar a
// tela. Rede "pendurada" conecta e não responde: a consulta de contagem não
// tinha prazo, o cartão ficava em "Conferindo a fila…" para sempre, sem aviso
// nem "Tentar de novo", e a releitura ao voltar ao app ficava bloqueada porque
// a leitura seguia marcada como em andamento.
//
// Casco de admin-reviews-fila-vem-do-banco.test.tsx, com relógio falso e a
// contagem dublada pendurada na primeira chamada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";

// Funções ESTÁVEIS entre renders: uma `vi.fn()` nova a cada render refaria a
// leitura (o efeito depende de `getAllReviews`) e gastaria a 1ª chamada pendurada.
const h = vi.hoisted(() => ({
  contagem: vi.fn(),
  getAllReviews: vi.fn(),
  subscribeToReviews: vi.fn(),
  lista: [] as unknown[],
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.lista,
    loading: false,
    getAllReviews: h.getAllReviews,
    deleteReview: vi.fn().mockResolvedValue(true),
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
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: h.contagem })),
    })),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminReviewsView — a contagem da fila tem prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    h.getAllReviews.mockResolvedValue({
      reviews: [],
      total: 0,
      averageRating: 0,
      globalVerifiedCount: 0,
      globalRepliedCount: 0,
    });
    h.subscribeToReviews.mockReturnValue(() => {});
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
    vi.stubGlobal("ResizeObserver", ObservadorStub);
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
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
    vi.useRealTimers();
    h.contagem.mockReset();
    h.getAllReviews.mockReset();
    h.subscribeToReviews.mockReset();
  });

  it("contagem pendurada: estoura o prazo, avisa com 'Tentar de novo' e a volta ao app relê", async () => {
    // 1ª chamada: conecta e não responde nunca. 2ª: responde com 5 na fila.
    h.contagem
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue({ count: 5, error: null });

    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    expect(hospedeiro.textContent).not.toContain("Não deu para conferir");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS + 100);
    });

    // Aviso de falha com o botão de repetir (antes: nada, para sempre).
    expect(hospedeiro.textContent).toContain(
      "Não deu para conferir a fila de moderação",
    );
    const repetir = Array.from(hospedeiro.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Tentar de novo",
    );
    expect(repetir.length).toBeGreaterThan(0);
    expect(h.contagem).toHaveBeenCalledTimes(1);

    // A marca de "leitura em andamento" foi solta: voltar ao app (mais de 30 s
    // depois) relê a contagem e o aviso some.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.contagem).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("5 na fila");
    expect(hospedeiro.textContent).not.toContain("Não deu para conferir");
  });
});
