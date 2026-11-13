// @vitest-environment jsdom
//
// A resposta da loja a uma AVALIAÇÃO não tinha limite: o campo não tinha
// `maxLength`, a validação só conferia "tem conteúdo visível" e o texto inteiro
// ia para a vitrine. Agora a resposta vai até 2000 caracteres (o mesmo teto da
// resposta às perguntas): a tela limita o campo, mostra o contador e, se o
// texto passar (colado de fora, resposta rápida somada ao que já havia), avisa
// e não deixa publicar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TETO = 2000;

const reviewFake = {
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

const addMerchantReply = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useReviews", () => {
  const retorno = {
    adminReviews: [reviewFake],
    loading: false,
    getAllReviews: vi
      .fn()
      .mockResolvedValue({ reviews: [reviewFake], total: 1, averageRating: 5 }),
    deleteReview: vi.fn().mockResolvedValue(true),
    aprovarReview: vi.fn().mockResolvedValue(true),
    addMerchantReply,
    subscribeToReviews: vi.fn().mockReturnValue(() => {}),
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

describe("AdminReviewsView — teto da resposta da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    addMerchantReply.mockResolvedValue(true);
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

    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => botao("Responder").click());
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  const botao = (texto: string) =>
    Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === texto,
    ) as HTMLButtonElement;

  async function digitar(texto: string) {
    const campo = document.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("o campo da resposta aceita no máximo 2000 caracteres", () => {
    const campo = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(campo.maxLength).toBe(TETO);
  });

  it("mostra o contador de caracteres", async () => {
    await digitar("Obrigada!");
    expect(hospedeiro.textContent).toContain(`9/${TETO} caracteres`);
    expect(hospedeiro.textContent).not.toContain("Máximo de");
  });

  it("texto colado acima do teto: avisa e não deixa publicar", async () => {
    await digitar("R".repeat(TETO + 500));
    expect(hospedeiro.textContent).toContain(`Máximo de ${TETO} caracteres`);
    expect(botao("Publicar resposta").disabled).toBe(true);

    await act(async () => botao("Publicar resposta").click());
    expect(addMerchantReply).not.toHaveBeenCalled();
  });

  it("controle: exatamente no teto publica", async () => {
    await digitar("R".repeat(TETO));
    expect(hospedeiro.textContent).not.toContain("Máximo de");
    expect(botao("Publicar resposta").disabled).toBe(false);
    await act(async () => botao("Publicar resposta").click());
    expect(addMerchantReply).toHaveBeenCalledTimes(1);
  });
});
