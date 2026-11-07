// @vitest-environment jsdom
//
// O sino do painel passou a manter no aviso a avaliação que ainda aguarda
// aprovação, mesmo depois da resposta da loja. Aprovar tira a avaliação desse
// aviso, então o hook avisa o painel pelo mesmo evento usado ao responder e ao
// excluir ("admin:recontar-avisos"). Falha não avisa: nada mudou no banco.
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
        eq: () => ({ select: () => Promise.resolve(h.resultadoUpdate) }),
      }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
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

type Acoes = Pick<ReturnType<typeof useReviews>, "aprovarReview">;
let acoes: Acoes | null = null;

function Capturador() {
  const { aprovarReview } = useReviews();
  useEffect(() => {
    acoes = { aprovarReview };
  }, [aprovarReview]);
  return null;
}

describe("useReviews — o sino do painel recontar ao aprovar", () => {
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

  it("aprovar com sucesso avisa o painel uma vez", async () => {
    h.resultadoUpdate = { data: [{ id: "rev-1" }], error: null };
    await montarHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await acoes!.aprovarReview("rev-1");
    });
    expect(ok).toBe(true);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("aprovar com erro do banco não avisa o painel", async () => {
    h.resultadoUpdate = { data: null, error: { message: "falhou" } };
    await montarHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await acoes!.aprovarReview("rev-1");
    });
    expect(ok).toBe(false);
    expect(aviso).not.toHaveBeenCalled();
  });

  it("aprovar sem nenhuma linha publicada não avisa o painel", async () => {
    h.resultadoUpdate = { data: [], error: null };
    await montarHook();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await acoes!.aprovarReview("rev-1");
    });
    expect(ok).toBe(false);
    expect(aviso).not.toHaveBeenCalled();
  });
});
