// @vitest-environment jsdom
//
// Laudo 0109 (A-4) — o cartão de moderação contava a fila pela LISTA da
// página atual (10 por página). Com a página cheia de publicadas e 3
// pendentes em OUTRAS páginas, o cartão dizia "Nenhuma avaliação na fila".
// O conserto: contagem REAL do banco (count exato, head — zero linhas na
// resposta), carregada no mesmo recarregamento da lista.
//
// Montagem: casco de admin-coupons-view-expirado.test.tsx (dublês nos hooks,
// view de verdade; stubs para o carrossel de KPIs emular embla no jsdom).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A lista DA PÁGINA vem com ZERO pendentes — a fila de 3 mora em outras
// páginas. É exatamente o cenário em que a contagem pela lista mentia.
let mockReviews: Array<Record<string, unknown>> = [
  {
    id: "r-1",
    customerName: "Ana Publicada",
    productName: "Produto A",
    rating: 5,
    comment: "Ótimo",
    verified: true,
    status: "publicada",
    helpful: 0,
    createdAt: new Date("2026-08-01T10:00:00Z").toISOString(),
    merchantReply: null,
  },
  {
    id: "r-2",
    customerName: "Bruno Publicada",
    productName: "Produto B",
    rating: 4,
    comment: "Bom",
    verified: false,
    status: "publicada",
    helpful: 0,
    createdAt: new Date("2026-08-02T10:00:00Z").toISOString(),
    merchantReply: null,
  },
];

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: mockReviews,
    loading: false,
    getAllReviews: vi.fn().mockResolvedValue({
      reviews: mockReviews,
      total: 64,
      averageRating: 4.5,
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

// O dublê do banco: a consulta de contagem com count exato devolve 3.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ count: 3, error: null })),
      })),
    })),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminReviewsView — a fila do cartão vem do banco, não da página (laudo 0109, A-4)", () => {
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
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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
    mockReviews = [];
  });

  it("página com 0 pendentes e count 3 no banco: o cartão mostra '3 aguardando sua aprovação'", async () => {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const tela = hospedeiro.textContent ?? "";

    // A contagem REAL do banco — com o defeito, aqui apareceria
    // "Nenhuma avaliação na fila de moderação" (a página não tem pendente).
    expect(tela).toContain("3 aguardando sua aprovação");
    expect(tela).not.toContain("Nenhuma avaliação na fila de moderação");

    // A LISTA continua sendo a da página: as duas publicadas aparecem e
    // nenhuma "Em moderação" inventada entra nela.
    expect(tela).toContain("Ana Publicada");
    expect(tela).toContain("Bruno Publicada");
    expect(tela).not.toContain("Em moderação");
  });
});
