// @vitest-environment jsdom
//
// Laudo 0109 (A-10) — metade do conserto no HOOK: `deleteReview` engolia o
// erro e devolvia void, então o chamador (AdminReviewsView) não tinha como
// saber se a exclusão aconteceu. Agora devolve Promise<boolean> — true só
// quando o banco confirmou; false em falha, mantendo o toast de erro.
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
  resultadoDelete: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: () => Promise.resolve(h.resultadoDelete),
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

type DeleteReviewFn = (reviewId: string) => Promise<boolean>;

let deleteReviewCapturado: DeleteReviewFn | null = null;

function Capturador() {
  const { deleteReview } = useReviews();
  useEffect(() => {
    deleteReviewCapturado = deleteReview as DeleteReviewFn;
  }, [deleteReview]);
  return null;
}

describe("useReviews.deleteReview — devolve booleano (laudo 0109, A-10)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // Os mocks do sonner são do módulo (compartilhados entre os testes
    // deste arquivo) — limpa as chamadas do teste anterior antes de tudo.
    vi.clearAllMocks();
    deleteReviewCapturado = null;
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
    expect(deleteReviewCapturado).toBeTypeOf("function");
  }

  it("banco confirma o delete: resolve true e canta sucesso", async () => {
    h.resultadoDelete = { data: null, error: null };

    await montarHook();
    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await deleteReviewCapturado!("rev-1");
    });

    expect(resposta).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Avaliação removida.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("banco recusa o delete: resolve false com o toast de erro (não lança)", async () => {
    h.resultadoDelete = {
      data: null,
      error: { message: "new row violates row-level security policy" },
    };

    await montarHook();
    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await deleteReviewCapturado!("rev-1");
    });

    expect(resposta).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Erro ao remover avaliação.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
