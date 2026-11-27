// @vitest-environment jsdom
//
// Avaliações › Aprovar: quem nunca comprou consegue enviar avaliação (ela entra pendente e SEM selo). Exigir compra no banco é
// decisão de produto em aberto; até lá a loja vê, junto do botão de aprovar, que aquela pessoa não tem compra registrada do
// produto — e o leitor de tela ouve o aviso no próprio botão. Com o selo, ou já publicada, nada muda.
// E o cartão do total diz o que conta: só as publicadas (migration 20261641000000), com as pendentes à parte.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getAllReviews: vi.fn(),
  subscribeToReviews: vi.fn(() => () => {}),
  reviews: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.reviews,
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
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: 1, error: null }),
        or: () => Promise.resolve({ count: 0, error: null }),
        is: () => Promise.resolve({ count: 0, error: null }),
      }),
    }),
    rpc: vi.fn(),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const AVISO = "Esta pessoa não tem compra registrada deste produto.";

function avaliacao(
  id: string,
  nome: string,
  verified: boolean,
  status: "pendente" | "publicada",
) {
  return {
    id,
    productId: "prod-1",
    productName: "Produto A",
    customerName: nome,
    rating: 5,
    comment: "Chegou rápido",
    verified,
    status,
    helpful: 0,
    createdAt: new Date("2026-08-01T10:00:00Z").toISOString(),
    merchantReply: null,
  };
}

describe("AdminReviewsView — aprovar avaliação sem compra registrada avisa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.getAllReviews.mockReset();
    h.getAllReviews.mockResolvedValue({
      reviews: [],
      total: 3,
      averageRating: 0,
      globalTotal: 1,
      globalAverageRating: 5,
      globalVerifiedCount: 1,
      globalRepliedCount: 0,
      globaisDisponiveis: true,
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
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
    vi.unstubAllGlobals();
    h.reviews = [];
  });

  async function abrirTela() {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const cartaoDe = (nome: string) =>
    Array.from(hospedeiro.querySelectorAll("li")).find((li) =>
      li.textContent?.includes(nome),
    ) as HTMLLIElement;
  const botaoAprovarDe = (nome: string) =>
    cartaoDe(nome).querySelector<HTMLButtonElement>(
      'button[aria-label="Aprovar e Publicar"]',
    );

  it("pendente SEM selo: o aviso aparece junto do botão e descreve o botão", async () => {
    h.reviews = [avaliacao("r-1", "Ana Sem Compra", false, "pendente")];
    await abrirTela();
    const cartao = cartaoDe("Ana Sem Compra");
    expect(cartao.textContent).toContain(AVISO);
    const botao = botaoAprovarDe("Ana Sem Compra");
    expect(botao).not.toBeNull();
    const ids = (botao?.getAttribute("aria-describedby") ?? "").split(" ");
    const descricao = ids
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(descricao).toContain(AVISO);
  });

  it("pendente COM selo e publicada sem selo: sem aviso", async () => {
    h.reviews = [
      avaliacao("r-2", "Bia Comprou", true, "pendente"),
      avaliacao("r-3", "Cris Publicada", false, "publicada"),
    ];
    await abrirTela();
    expect(cartaoDe("Bia Comprou").textContent).not.toContain(AVISO);
    expect(
      botaoAprovarDe("Bia Comprou")?.hasAttribute("aria-describedby"),
    ).toBe(false);
    expect(cartaoDe("Cris Publicada").textContent).not.toContain(AVISO);
    expect(hospedeiro.textContent).not.toContain(AVISO);
  });

  it("o cartão do total diz que conta as publicadas", async () => {
    h.reviews = [avaliacao("r-1", "Ana Sem Compra", false, "pendente")];
    await abrirTela();
    const expandir = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Expandir"),
    );
    await act(async () => {
      expandir?.click();
    });
    expect(hospedeiro.textContent).toContain("Total publicado");
    expect(hospedeiro.textContent).not.toContain("Total recebido");
  });
});
