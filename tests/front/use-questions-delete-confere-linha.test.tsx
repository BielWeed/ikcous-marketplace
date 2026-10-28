// @vitest-environment jsdom
//
// Excluir pergunta (caça 13, D4): `deleteQuestion` apagava sem conferir as
// linhas — exclusão barrada pelo banco (0 linhas, sem erro) voltava como
// sucesso e a tela dizia "Pergunta excluída" com a pergunta ainda lá. Agora
// segue o molde de `deleteReview` e `deleteCoupon`: `.select("id")` e 0
// linhas é falha. O hook de verdade roda com o cliente do Supabase dublado.
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
  admin: true,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: () => ({
          // Molde do PostgREST: sem `.select`, a promessa não traz as linhas.
          select: () => Promise.resolve(h.resultadoDelete),
          // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: h.resultadoDelete.error,
            }).then(resolve),
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-teste" },
    isAdmin: h.admin,
    loading: false,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedQuestionsData: null,
  setCachedQuestionsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuestions } from "@/hooks/useQuestions";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ExcluirFn = (
  id: string,
  opcoes?: { silent?: boolean },
) => Promise<boolean>;
let excluir: ExcluirFn | null = null;

function Capturador() {
  const { deleteQuestion } = useQuestions();
  useEffect(() => {
    excluir = deleteQuestion as ExcluirFn;
  }, [deleteQuestion]);
  return null;
}

describe("useQuestions.deleteQuestion — confere se apagou linha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    h.admin = true;
    excluir = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Capturador />);
    });
    await act(async () => {});
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("o banco apagou a linha: true e aviso de sucesso", async () => {
    h.resultadoDelete = { data: [{ id: "q-1" }], error: null };
    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await excluir!("q-1");
    });
    expect(resposta).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Pergunta removida.");
  });

  it("0 linhas apagadas (barrado pelo banco, sem erro): false e aviso de erro", async () => {
    h.resultadoDelete = { data: [], error: null };
    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await excluir!("q-1");
    });
    expect(resposta).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Erro ao remover pergunta.");
  });

  it("0 linhas com `silent`: false e nenhum aviso (a tela é quem avisa)", async () => {
    h.resultadoDelete = { data: [], error: null };
    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await excluir!("q-1", { silent: true });
    });
    expect(resposta).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("erro do banco continua false", async () => {
    h.resultadoDelete = { data: null, error: { message: "rede" } };
    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await excluir!("q-1");
    });
    expect(resposta).toBe(false);
  });
});
