// @vitest-environment jsdom
//
// Painel > Avaliações (caça 13, itens D3 e C3):
//  - Excluir: o botão fica travado enquanto a exclusão grava (antes, um segundo
//    toque dava "removida" e "Erro ao remover" juntos).
//  - O resumo e o cartão da fila nunca mostram "★ 0,0 · 0 avaliações" nem
//    "Nenhuma na fila" sem uma leitura bem-sucedida: carregando mostra "—",
//    falha avisa com "Tentar de novo", e só o vazio de verdade diz "0"/"Nenhuma".
//  - Plural: "1 avaliação".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reviews: [] as Array<Record<string, unknown>>,
  erroDaListagemAdmin: null as string | null,
  getAllReviews: vi.fn(),
  deleteReview: vi.fn(),
  contagem: vi.fn(),
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.reviews,
    loading: false,
    erroDaListagemAdmin: h.erroDaListagemAdmin,
    getAllReviews: h.getAllReviews,
    deleteReview: h.deleteReview,
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
    from: () => ({
      select: () => ({ eq: () => h.contagem() }),
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
  id: "r-1",
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
    globalAverageRating: total > 0 ? 5 : 0,
    globaisDisponiveis: true,
  };
}

describe("AdminReviewsView — excluir e leitura que falha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.reviews = [UMA];
    h.erroDaListagemAdmin = null;
    h.getAllReviews.mockReset().mockResolvedValue(leitura(1));
    h.deleteReview.mockReset();
    h.contagem.mockReset().mockResolvedValue({ count: 0, error: null });
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

  async function montar() {
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
  async function expandir() {
    await act(async () => {
      botao("Expandir")?.click();
    });
  }
  const texto = () => hospedeiro.textContent ?? "";

  describe("excluir", () => {
    it("toque duplo em Excluir: uma exclusão só, botão trava e a confirmação fecha", async () => {
      let terminar!: (ok: boolean) => void;
      h.deleteReview.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            terminar = resolve;
          }),
      );
      await montar();
      await act(async () => {
        hospedeiro
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Excluir avaliação"]',
          )
          ?.click();
      });
      const excluir = botao("Excluir") as HTMLButtonElement;
      await act(async () => {
        excluir.click();
        excluir.click();
      });
      expect(h.deleteReview).toHaveBeenCalledTimes(1);
      // Gravando: o botão avisa e não aceita outro toque, nem o Cancelar.
      const gravando = botao("Excluindo…") as HTMLButtonElement;
      expect(gravando.disabled).toBe(true);
      expect((botao("Cancelar") as HTMLButtonElement).disabled).toBe(true);
      await act(async () => {
        gravando.click();
      });
      expect(h.deleteReview).toHaveBeenCalledTimes(1);

      await act(async () => {
        terminar(true);
      });
      expect(h.deleteReview).toHaveBeenCalledTimes(1);
      expect(botao("Excluindo…")).toBeUndefined();
      expect(botao("Excluir")).toBeUndefined();
    });

    it("exclusão que falha libera o botão (a confirmação fecha, sem travar para sempre)", async () => {
      h.deleteReview.mockResolvedValue(false);
      await montar();
      await act(async () => {
        hospedeiro
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Excluir avaliação"]',
          )
          ?.click();
      });
      await act(async () => {
        botao("Excluir")?.click();
      });
      expect(botao("Excluindo…")).toBeUndefined();
      expect(h.deleteReview).toHaveBeenCalledTimes(1);
    });
  });

  describe("números do topo", () => {
    it("plural: 1 avaliação, 2 avaliações", async () => {
      await montar();
      expect(texto()).toContain("1 avaliação");
      expect(texto()).not.toContain("1 avaliações");
      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      h.getAllReviews.mockResolvedValue(leitura(2));
      await montar();
      expect(texto()).toContain("2 avaliações");
    });

    it("antes da primeira leitura não inventa '0,0' nem '0 avaliações'", async () => {
      h.getAllReviews.mockReturnValue(new Promise(() => {}));
      await montar();
      expect(texto()).not.toContain("0,0");
      expect(texto()).not.toContain("0 avaliações");
      expect(texto()).toContain("—");
      await expandir();
      expect(texto()).not.toContain("Nenhuma na fila");
      expect(texto()).not.toContain("0 respondidas");
      expect(texto()).toContain("Conferindo a fila");
    });

    it("leitura da lista que falha: traço no lugar de zeros e 'Tentar de novo'", async () => {
      h.reviews = [];
      h.erroDaListagemAdmin = "Não foi possível carregar as avaliações.";
      h.getAllReviews.mockResolvedValue(undefined);
      h.contagem.mockResolvedValue({ count: null, error: { message: "rede" } });
      await montar();
      expect(texto()).not.toContain("0,0");
      expect(texto()).not.toContain("0 avaliações");
      await expandir();
      expect(texto()).not.toContain("Nenhuma na fila");
      expect(texto()).not.toContain("0 respondidas");
      expect(botao("Tentar de novo")).toBeTruthy();
      expect(texto()).not.toContain("Sem avaliações ainda");
    });

    it("só a contagem da fila falha: avisa, nunca diz 'Nenhuma na fila', e tentar de novo conta", async () => {
      h.contagem.mockResolvedValue({ count: null, error: { message: "rede" } });
      await montar();
      expect(texto()).toContain("Não deu para conferir a fila");
      await expandir();
      expect(texto()).not.toContain("Nenhuma na fila");
      // A lista veio: as avaliações aparecem, só a fila ficou sem conferir.
      expect(texto()).toContain("Ana Teste");

      h.contagem.mockResolvedValue({ count: 2, error: null });
      await act(async () => {
        botao("Tentar de novo")?.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(texto()).toContain("2 para aprovar");
      expect(texto()).not.toContain("Não deu para conferir a fila");
    });

    it("controle: loja sem avaliação nenhuma, leitura boa — o zero é verdadeiro", async () => {
      h.reviews = [];
      h.getAllReviews.mockResolvedValue(leitura(0));
      await montar();
      expect(texto()).toContain("0 avaliações");
      expect(texto()).toContain("Sem avaliações ainda");
      await expandir();
      expect(texto()).toContain("Nenhuma na fila");
      expect(texto()).not.toContain("Não deu para conferir");
    });

    it("controle: leitura boa mostra os números reais", async () => {
      h.getAllReviews.mockResolvedValue(leitura(7));
      h.contagem.mockResolvedValue({ count: 3, error: null });
      await montar();
      expect(texto()).toContain("7 avaliações");
      expect(texto()).toContain("3 na fila");
    });
  });
});
