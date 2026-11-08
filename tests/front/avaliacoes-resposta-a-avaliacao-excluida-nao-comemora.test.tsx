// @vitest-environment jsdom
//
// A lojista abre "Responder" no celular; no computador a mesma avaliação é
// excluída. A função do banco (reply_review_atomic) não acha linha, não dá
// erro e devolve vazio: o hook comemorava "Resposta enviada com sucesso!" sem
// que nada tivesse sido gravado. Agora ele confere que a avaliação ainda existe
// depois do envio e só comemora se existir.
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
  resultadoRpc: { data: null as unknown, error: null as unknown },
  resultadoLeitura: { data: null as unknown, error: null as unknown },
  idsLidos: [] as string[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_coluna: string, id: string) => {
          h.idsLidos.push(id);
          return Promise.resolve(h.resultadoLeitura);
        },
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
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let responder: ReturnType<typeof useReviews>["addMerchantReply"] | null = null;

function Capturador() {
  const { addMerchantReply } = useReviews();
  useEffect(() => {
    responder = addMerchantReply;
  }, [addMerchantReply]);
  return null;
}

describe("useReviews — responder uma avaliação que já foi excluída", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aviso = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    responder = null;
    h.idsLidos = [];
    h.resultadoRpc = { data: null, error: null };
    window.addEventListener("admin:recontar-avisos", aviso);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Capturador />);
    });
    await act(async () => {});
    expect(responder).not.toBeNull();
  });

  afterEach(() => {
    window.removeEventListener("admin:recontar-avisos", aviso);
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("avaliação excluída: diz que não foi enviada e não comemora", async () => {
    h.resultadoLeitura = { data: [], error: null };
    let ok: boolean | undefined;
    await act(async () => {
      ok = await responder!("rev-1", "Obrigada!");
    });
    expect(ok).toBe(false);
    expect(h.idsLidos).toEqual(["rev-1"]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Esta avaliação já foi excluída. A resposta não foi enviada.",
    );
  });

  it("avaliação existente: comemora e devolve verdadeiro", async () => {
    h.resultadoLeitura = { data: [{ id: "rev-1" }], error: null };
    let ok: boolean | undefined;
    await act(async () => {
      ok = await responder!("rev-1", "Obrigada!");
    });
    expect(ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Resposta enviada com sucesso!");
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("conferência que falha por rede não desmente um envio que o banco aceitou", async () => {
    h.resultadoLeitura = { data: null, error: { message: "rede" } };
    let ok: boolean | undefined;
    await act(async () => {
      ok = await responder!("rev-1", "Obrigada!");
    });
    expect(ok).toBe(true);
    expect(toast.success).toHaveBeenCalled();
  });
});
