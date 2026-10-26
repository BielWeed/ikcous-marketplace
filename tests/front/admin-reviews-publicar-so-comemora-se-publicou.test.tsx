// @vitest-environment jsdom
//
// Avaliações › Aprovar e publicar:
//  - se a publicação FALHA (rede, permissão), o aparelho não vibra "deu certo"
//    e a lista não é recarregada como se algo tivesse mudado: vibra de erro;
//  - o toque duplo no botão não publica duas vezes: enquanto uma publicação
//    está em andamento o botão fica parado.
import { haptic } from "@/utils/haptic";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  aprovarReview: vi.fn(),
  getAllReviews: vi.fn(),
  // Estável de propósito: um dublê novo a cada render faria a tela recarregar
  // sozinha e esconderia se foi o botão que pediu a recarga.
  subscribeToReviews: vi.fn(() => () => {}),
  reviews: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.reviews,
    loading: false,
    getAllReviews: h.getAllReviews,
    deleteReview: vi.fn().mockResolvedValue(true),
    aprovarReview: h.aprovarReview,
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
// A tela conta a fila de pendentes direto no banco: select().eq() resolve.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: 1, error: null }),
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

function pendente(id: string) {
  return {
    id,
    productId: "prod-1",
    productName: "Produto A",
    customerName: "Ana Teste",
    rating: 5,
    comment: "Chegou rápido",
    verified: false,
    status: "pendente",
    helpful: 0,
    createdAt: new Date("2026-08-01T10:00:00Z").toISOString(),
    merchantReply: null,
  };
}

describe("AdminReviewsView — publicar só comemora se publicou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let sucesso: ReturnType<typeof vi.spyOn>;
  let erro: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sucesso = vi.spyOn(haptic, "success");
    erro = vi.spyOn(haptic, "error");
    h.aprovarReview.mockReset();
    h.getAllReviews.mockReset();
    h.getAllReviews.mockResolvedValue({
      reviews: [],
      total: 0,
      averageRating: 0,
    });
    h.reviews = [pendente("r-1")];
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
    sucesso.mockRestore();
    erro.mockRestore();
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

  const botaoAprovar = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Aprovar e Publicar"]',
    ) as HTMLButtonElement;

  it("publicação que falha: vibra de erro, não de sucesso, e não recarrega a lista", async () => {
    h.aprovarReview.mockResolvedValue(false);
    await abrirTela();
    const carregamentos = h.getAllReviews.mock.calls.length;

    await act(async () => {
      botaoAprovar().click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(h.aprovarReview).toHaveBeenCalledWith("r-1");
    expect(sucesso).not.toHaveBeenCalled();
    expect(erro).toHaveBeenCalledTimes(1);
    expect(h.getAllReviews.mock.calls.length).toBe(carregamentos);
  });

  it("controle — publicação que deu certo: vibra de sucesso e recarrega a lista", async () => {
    h.aprovarReview.mockResolvedValue(true);
    await abrirTela();
    const carregamentos = h.getAllReviews.mock.calls.length;

    await act(async () => {
      botaoAprovar().click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(sucesso).toHaveBeenCalledTimes(1);
    expect(erro).not.toHaveBeenCalled();
    expect(h.getAllReviews.mock.calls.length).toBeGreaterThan(carregamentos);
  });

  it("toque duplo: a avaliação é publicada uma vez só", async () => {
    let terminar: (ok: boolean) => void = () => {};
    h.aprovarReview.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          terminar = resolve;
        }),
    );
    await abrirTela();

    await act(async () => {
      botaoAprovar().click();
      botaoAprovar().click();
      await Promise.resolve();
    });
    expect(h.aprovarReview).toHaveBeenCalledTimes(1);
    expect(botaoAprovar().disabled).toBe(true);

    await act(async () => {
      terminar(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.aprovarReview).toHaveBeenCalledTimes(1);
  });

  it("depois de uma falha o botão volta a funcionar para tentar de novo", async () => {
    h.aprovarReview.mockResolvedValueOnce(false).mockResolvedValue(true);
    await abrirTela();

    await act(async () => {
      botaoAprovar().click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(botaoAprovar().disabled).toBe(false);

    await act(async () => {
      botaoAprovar().click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.aprovarReview).toHaveBeenCalledTimes(2);
  });
});
