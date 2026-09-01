import { haptic } from "@/utils/haptic";
// @vitest-environment jsdom
//
// Laudo 0109 (A-10) — `handleDelete` dava `haptic.success()` (a vibração de
// "deu certo") SEM olhar o resultado da exclusão: o hook engolia o erro e
// devolvia void, então falha (rede, permissão) vibrrava sucesso igual.
// Com o hook devolvendo booleano, a vibração de sucesso só toca com `true`.
//
// Montagem: casco de admin-coupons-view-expirado.test.tsx com o haptic
// ESPIONADO — a prova é sobre as chamadas, não sobre o DOM.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteReview = vi.fn();

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: mockReviews,
    loading: false,
    getAllReviews: vi.fn().mockResolvedValue({
      reviews: mockReviews,
      total: mockReviews.length,
      averageRating: 0,
    }),
    deleteReview,
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
// A view importa o supabase para a contagem da fila (laudo 0109, A-4) —
// sem o mock, o cliente real estoura no jsdom.
vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

let mockReviews: Array<Record<string, unknown>> = [];

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

function reviewFake(id: string) {
  return {
    id,
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
}

describe("AdminReviewsView — o haptic de sucesso só toca na exclusão que deu certo (laudo 0109, A-10)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let espiaoSucesso: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom sem navigator.vibrate: o haptic vira no-op medível pelo espião.
    espiaoSucesso = vi.spyOn(haptic, "success");
    deleteReview.mockReset();
    mockReviews = [reviewFake("r-1")];
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
    espiaoSucesso.mockRestore();
    vi.unstubAllGlobals();
    mockReviews = [];
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

  async function confirmarExclusao() {
    // Modo compacto (default sem localStorage): lixeira com title "Excluir".
    const lixeira = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Excluir",
    );
    expect(lixeira).toBeTruthy();
    await act(async () => {
      lixeira!.click();
    });
    const sim = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Sim",
    );
    expect(sim).toBeTruthy();
    await act(async () => {
      sim!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("delete falha (false): haptic.success NÃO é chamado", async () => {
    deleteReview.mockResolvedValue(false);

    await abrirTela();
    await confirmarExclusao();

    expect(deleteReview).toHaveBeenCalledWith("r-1");
    expect(espiaoSucesso).not.toHaveBeenCalled();
  });

  it("controle — delete sucesso (true): haptic.success é chamado", async () => {
    deleteReview.mockResolvedValue(true);

    await abrirTela();
    await confirmarExclusao();

    expect(deleteReview).toHaveBeenCalledWith("r-1");
    expect(espiaoSucesso).toHaveBeenCalledTimes(1);
  });
});
