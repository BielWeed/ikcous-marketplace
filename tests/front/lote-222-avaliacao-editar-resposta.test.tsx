// @vitest-environment jsdom
//
// Lote 222 (M5): avaliação que já tem resposta ganha "Editar resposta", que
// abre o campo com o texto de hoje.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const base = {
    id: "r-1",
    customerName: "Ana Teste",
    productName: "Produto A",
    rating: 5,
    comment: "Ótimo",
    verified: false,
    status: "publicada",
    helpful: 0,
    createdAt: new Date("2026-08-01T10:00:00Z").toISOString(),
    merchantReply: "Obrigado, Ana!" as string | null,
  };
  const estado = { reviews: [base] };
  // O envio grava a resposta no "banco": a lista seguinte já a traz.
  const addMerchantReply = vi.fn(async (_id: string, texto: string) => {
    estado.reviews = [{ ...base, merchantReply: texto }];
    return true;
  });
  return { base, estado, addMerchantReply };
});

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.estado.reviews,
    loading: false,
    getAllReviews: async () => ({
      reviews: h.estado.reviews,
      total: 1,
      averageRating: 5,
    }),
    deleteReview: vi.fn().mockResolvedValue(true),
    aprovarReview: vi.fn().mockResolvedValue(true),
    addMerchantReply: h.addMerchantReply,
    subscribeToReviews: vi.fn().mockReturnValue(() => {}),
  }),
}));
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

describe("lote 222 — editar a resposta da loja", () => {
  const onSetDirty = vi.fn();
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.estado.reviews = [{ ...h.base, merchantReply: "Obrigado, Ana!" }];
    onSetDirty.mockClear();
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

  async function montar() {
    const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
    await act(async () => {
      raiz.render(
        <AdminReviewsView
          active={true}
          onNavigate={vi.fn()}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  async function abrirFormulario() {
    await montar();
    await act(async () => botao("Editar resposta").click());
  }
  const campo = () => document.querySelector("textarea") as HTMLTextAreaElement;
  async function digitar(texto: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(campo(), texto);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const ultimoDirty = () => onSetDirty.mock.calls.at(-1)?.[0];

  it("com resposta dada, aparece 'Editar resposta' (e não 'Responder')", async () => {
    await abrirFormulario();
    expect(botao("Responder")).toBeUndefined();
    expect(campo().value).toBe("Obrigado, Ana!");
  });

  it("abrir 'Editar resposta' sem mexer não conta como alteração não salva", async () => {
    await abrirFormulario();
    expect(ultimoDirty()).toBe(false);
    await digitar("Obrigado, Ana! Volte sempre.");
    expect(ultimoDirty()).toBe(true);
    await digitar("Obrigado, Ana!");
    expect(ultimoDirty()).toBe(false);
  });

  it("responder, enviar e editar: o campo traz o texto enviado (e na 2ª edição também)", async () => {
    h.estado.reviews = [{ ...h.base, merchantReply: null }];
    await montar();
    await act(async () => botao("Responder").click());
    await digitar("Primeira resposta");
    await act(async () => botao("Publicar resposta").click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => botao("Editar resposta").click());
    expect(campo().value).toBe("Primeira resposta");
    await digitar("Segunda resposta");
    await act(async () => botao("Publicar resposta").click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => botao("Editar resposta").click());
    expect(campo().value).toBe("Segunda resposta");
    expect(ultimoDirty()).toBe(false);
  });
});
