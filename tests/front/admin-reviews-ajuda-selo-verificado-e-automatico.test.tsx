// @vitest-environment jsdom
//
// Laudo 0109 (A-6) — a ajuda de "Compra Verificada" prometia "Você pode
// marcar ou desmarcar manualmente", mas o botão manual SAIU (o selo passou a
// ser derivado da compra com pagamento reconhecido pelas triggers da
// 20261030000000). Texto que promete interruptor inexistente manda a lojista
// procurar um botão que não está lá.
//
// Montagem: casco de admin-coupons-view-expirado.test.tsx — o guia abre por
// portal em document.body, como lá.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: [],
    loading: false,
    getAllReviews: vi.fn().mockResolvedValue({
      reviews: [],
      total: 0,
      averageRating: 0,
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
vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
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

describe("AdminReviewsView — a ajuda do selo Verificado descreve o automático (laudo 0109, A-6)", () => {
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
  });

  it("a ajuda NÃO promete marcação manual e descreve o selo automático", async () => {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const botaoDeAjuda = Array.from(hospedeiro.querySelectorAll("button")).find(
      (el) => el.getAttribute("title") === "Guia de Avaliações e Ajuda",
    );
    expect(botaoDeAjuda).toBeTruthy();

    await act(async () => {
      botaoDeAjuda?.click();
    });

    // O modal é montado via createPortal em document.body, fora de `hospedeiro`.
    const textoDoModal = document.body.textContent ?? "";

    // A promessa mentirosa não pode mais existir.
    expect(textoDoModal).not.toContain("manualmente");
    // O que a lojista lê agora é o mecanismo de verdade.
    expect(textoDoModal).toContain("O selo é automático");
    expect(textoDoModal).toContain("pagamento reconhecido");
  });
});
