// @vitest-environment jsdom
//
// Frente F (F10) — `aprovarReview` (publicar avaliação) fazia o mesmo que o
// `deleteReview` fazia antes do laudo 0109: engolia o erro e devolvia void,
// então a tela vibrava "deu certo" mesmo com o banco recusando. Agora devolve
// Promise<boolean> — true só quando o banco confirmou; false em falha.
//
// O hook de verdade é exercitado com o cliente do Supabase dublado — mesmo
// precedente de use-reviews-erro-do-banco-nao-vaza-na-tela.test.tsx.
vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    class BroadcastChannelFalso {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
      BroadcastChannelFalso;
  }
});

const h = vi.hoisted(() => ({
  resultadoUpdate: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve(h.resultadoUpdate),
      }),
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-teste" },
    isAdmin: true,
    loading: false,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type AprovarReviewFn = (reviewId: string) => Promise<boolean>;

let aprovarCapturado: AprovarReviewFn | null = null;

function Capturador() {
  const { aprovarReview } = useReviews();
  useEffect(() => {
    aprovarCapturado = aprovarReview as AprovarReviewFn;
  }, [aprovarReview]);
  return null;
}

describe("useReviews.aprovarReview — devolve booleano (Frente F, F10)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Os mocks do sonner são do módulo (compartilhados entre os testes
    // deste arquivo) — limpa as chamadas do teste anterior antes de tudo.
    vi.clearAllMocks();
    aprovarCapturado = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montarHook() {
    await act(async () => {
      raiz.render(<Capturador />);
    });
    await act(async () => {});
    expect(aprovarCapturado).toBeTypeOf("function");
  }

  it("banco confirma a publicação: resolve true e canta sucesso", async () => {
    h.resultadoUpdate = { data: null, error: null };

    await montarHook();
    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await aprovarCapturado!("rev-1");
    });

    expect(resposta).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Avaliação publicada.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("banco recusa a publicação: resolve false com o toast de erro (não lança)", async () => {
    h.resultadoUpdate = {
      data: null,
      error: { message: "new row violates row-level security policy" },
    };

    await montarHook();
    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await aprovarCapturado!("rev-1");
    });

    expect(resposta).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Erro ao publicar avaliação.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
