// @vitest-environment jsdom
//
// Lote 205: tocar numa resposta rápida ("Agradecer feedback") substituía o
// texto que a lojista já tinha digitado. Agora a sugestão entra no fim; com o
// campo vazio, entra sozinha.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/hooks/useReviews", () => {
  const retorno = {
    adminReviews: [reviewFake],
    loading: false,
    getAllReviews: vi
      .fn()
      .mockResolvedValue({ reviews: [reviewFake], total: 1, averageRating: 5 }),
    deleteReview: vi.fn().mockResolvedValue(true),
    aprovarReview: vi.fn().mockResolvedValue(true),
    addMerchantReply: vi.fn().mockResolvedValue(true),
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

describe("AdminReviewsView — resposta rápida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    vi.unstubAllGlobals();
  });

  const botao = (texto: string) =>
    Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === texto,
    ) as HTMLButtonElement;

  async function abrirFormulario() {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(<AdminReviewsView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => botao("Responder").click());
  }

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

  const valor = () =>
    (document.querySelector("textarea") as HTMLTextAreaElement).value;

  it("com texto já digitado, a sugestão entra no fim e o texto fica", async () => {
    await abrirFormulario();
    await digitar("Oi, Ana!");
    await act(async () => botao("Agradecer feedback").click());
    expect(
      valor().startsWith("Oi, Ana! Muito obrigado pela sua avaliação"),
    ).toBe(true);
  });

  it("com o campo vazio, a sugestão entra sozinha", async () => {
    await abrirFormulario();
    await act(async () => botao("Agradecer feedback").click());
    expect(valor().startsWith("Muito obrigado pela sua avaliação")).toBe(true);
  });
});
