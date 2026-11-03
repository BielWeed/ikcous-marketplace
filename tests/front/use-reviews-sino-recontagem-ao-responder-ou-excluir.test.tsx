// @vitest-environment jsdom
//
// O sino do painel conta avaliações sem resposta (AdminLayout) e não tem canal
// de tempo real para elas. Quando a própria lojista responde ou exclui uma
// avaliação, o hook avisa o painel pelo mesmo evento já usado pela política de
// devolução ("admin:recontar-avisos"); falha não avisa (nada mudou no banco).
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
  resultadoRpc: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: () => ({ select: () => Promise.resolve(h.resultadoDelete) }),
      }),
    }),
    rpc: () => Promise.resolve(h.resultadoRpc),
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Acoes = Pick<
  ReturnType<typeof useReviews>,
  "deleteReview" | "addMerchantReply"
>;
let acoes: Acoes | null = null;

function Capturador() {
  const { deleteReview, addMerchantReply } = useReviews();
  useEffect(() => {
    acoes = { deleteReview, addMerchantReply };
  }, [deleteReview, addMerchantReply]);
  return null;
}

describe("useReviews — o sino do painel recontar ao responder ou excluir", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aviso = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    acoes = null;
    window.addEventListener("admin:recontar-avisos", aviso);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    window.removeEventListener("admin:recontar-avisos", aviso);
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
    expect(acoes).not.toBeNull();
  }

  it("responder com sucesso avisa o painel uma vez", async () => {
    h.resultadoRpc = { data: null, error: null };
    await montarHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await acoes!.addMerchantReply("rev-1", "Obrigada!");
    });
    expect(ok).toBe(true);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("responder com erro do banco não avisa o painel", async () => {
    h.resultadoRpc = { data: null, error: { message: "falhou" } };
    await montarHook();
    await act(async () => {
      await acoes!.addMerchantReply("rev-1", "Obrigada!");
    });
    expect(aviso).not.toHaveBeenCalled();
  });

  it("excluir com sucesso avisa o painel uma vez", async () => {
    h.resultadoDelete = { data: [{ id: "rev-1" }], error: null };
    await montarHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await acoes!.deleteReview("rev-1");
    });
    expect(ok).toBe(true);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("excluir com erro do banco não avisa o painel", async () => {
    h.resultadoDelete = { data: null, error: { message: "negado" } };
    await montarHook();
    await act(async () => {
      await acoes!.deleteReview("rev-1");
    });
    expect(aviso).not.toHaveBeenCalled();
  });
});
