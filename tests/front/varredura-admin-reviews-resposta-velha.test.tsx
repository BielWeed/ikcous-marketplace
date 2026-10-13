// @vitest-environment jsdom
//
// Varredura de bugs (13/10/2026) — `AdminReviewsView.loadReviews` não tem
// guarda de rodada: o realtime dispara `loadReviews(page, true)` junto da
// leitura em curso, e se a resposta MAIS VELHA chega por último ela
// sobrescreve `totalReviews` (e os contadores globais) com um número que já
// não vale — e, no caso da paginação, ainda pode mandar `setPage`. A
// AdminCustomersView já descarta a resposta superada (`rodadaRef`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  respostas: [] as Array<(r: unknown) => void>,
  aoMudar: null as null | (() => void),
}));

vi.mock("@/hooks/useReviews", () => {
  // Identidade ESTÁVEL entre renders, como no app: funções novas a cada render
  // reabririam o efeito de carga sem que nada tivesse mudado.
  const getAllReviews = vi.fn(
    () => new Promise((resolve) => h.respostas.push(resolve)),
  );
  const subscribeToReviews = vi.fn((cb: () => void) => {
    h.aoMudar = cb;
    return () => {};
  });
  const retorno = {
    adminReviews: [] as unknown[],
    loading: false,
    getAllReviews,
    deleteReview: vi.fn().mockResolvedValue(true),
    aprovarReview: vi.fn().mockResolvedValue(true),
    addMerchantReply: vi.fn().mockResolvedValue(true),
    subscribeToReviews,
  };
  return { useReviews: () => retorno };
});

vi.mock("@/contexts/StoreContext", () => {
  const retorno = {
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  };
  return { useStore: () => retorno };
});

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
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const leitura = (total: number) => ({
  reviews: [],
  total,
  averageRating: 4.5,
  globalVerifiedCount: 0,
  globalRepliedCount: 0,
  globalTotal: total,
  globaisDisponiveis: true,
});

describe("AdminReviewsView — a resposta superada não sobrescreve a mais nova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.respostas.length = 0;
    h.aoMudar = null;
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    vi.stubGlobal("ResizeObserver", Observador);
    vi.stubGlobal("IntersectionObserver", Observador);
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
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  const totalNaTela = () =>
    hospedeiro
      .querySelector('[title="Total de avaliações"]')
      ?.textContent?.trim();

  async function montarComDuasLeituras() {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    // Leitura 1 (carga da tela) pendurada; o realtime dispara a leitura 2.
    expect(h.respostas).toHaveLength(1);
    await act(async () => {
      h.aoMudar?.();
    });
    expect(h.respostas).toHaveLength(2);
  }

  it("a leitura nova responde primeiro e a velha chega depois: vale a nova", async () => {
    await montarComDuasLeituras();
    await act(async () => {
      h.respostas[1](leitura(77)); // a mais nova
    });
    await act(async () => {
      h.respostas[0](leitura(33)); // a mais velha, atrasada
    });
    expect(totalNaTela()).toBe("77");
  });

  it("controle: na ordem normal (velha, depois nova) vale a nova", async () => {
    await montarComDuasLeituras();
    await act(async () => {
      h.respostas[0](leitura(33));
    });
    await act(async () => {
      h.respostas[1](leitura(77));
    });
    expect(totalNaTela()).toBe("77");
  });
});
