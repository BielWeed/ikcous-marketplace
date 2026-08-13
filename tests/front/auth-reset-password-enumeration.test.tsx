import type { ResetPasswordResult } from "@/contexts/AuthContext";
// @vitest-environment jsdom
//
// Issue #120 — `resetPassword` chamava a RPC `check_user_confirmation_status`
// antes de decidir o que fazer, e devolvia uma mensagem DIFERENTE por
// resultado ('not_found' vs 'unconfirmed' vs 'success'): um visitante
// jogando uma lista de e-mails no endpoint REST descobria quem tem conta e
// quem confirmou. A correção troca a checagem prévia por uma chamada direta
// a `supabase.auth.resetPasswordForEmail`, que por design do Supabase Auth
// não confirma nem nega a existência da conta — e a função nunca mais chama
// a RPC revogada (ver migration nova em `supabase/migrations/`).
//
// Mesmo padrão de auth-admin-check.test.tsx / auth-logout-cleanup.test.tsx.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      resend: vi.fn(),
    },
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { message: "não usado nestes testes" },
            }),
        }),
      }),
    })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  resetPassword: (email: string) => Promise<ResetPasswordResult>;
}

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as Snapshot;
  aoAtualizar({ resetPassword: ctx.resetPassword });
  return null;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function criarLocalStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("AuthContext.resetPassword — fecha a enumeração de e-mails (issue #120)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
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
    vi.restoreAllMocks();
  });

  async function montar() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });

    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    return {
      supabase,
      resetPassword: ultimoEstado(aoAtualizar)!.resetPassword,
    };
  }

  it("1. devolve resultado indistinguível para um e-mail cadastrado e um não cadastrado", async () => {
    const { supabase, resetPassword } = await montar();

    // O Supabase Auth de verdade não distingue os dois casos: sempre
    // resolve sem erro. O dublê reproduz esse comportamento.
    (
      supabase.auth.resetPasswordForEmail as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: {}, error: null });

    let resultadoCadastrado: ResetPasswordResult;
    let resultadoNaoCadastrado: ResetPasswordResult;
    await act(async () => {
      resultadoCadastrado = await resetPassword("existe@example.com");
      resultadoNaoCadastrado = await resetPassword("nao-existe@example.com");
    });

    expect(resultadoCadastrado!).toEqual(resultadoNaoCadastrado!);
    expect(resultadoCadastrado!.status).toBe("success");
    expect(resultadoCadastrado!.success).toBe(true);
  });

  it("2. não chama mais a RPC check_user_confirmation_status", async () => {
    const { supabase, resetPassword } = await montar();

    (
      supabase.auth.resetPasswordForEmail as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: {}, error: null });

    await act(async () => {
      await resetPassword("qualquer@example.com");
    });

    const chamadasRpc = (
      supabase.rpc as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      (args: unknown[]) => args[0] === "check_user_confirmation_status",
    );
    expect(chamadasRpc.length).toBe(0);
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "qualquer@example.com",
      expect.objectContaining({ redirectTo: expect.any(String) }),
    );
  });

  // Revisão de contexto limpo do diff (achado 3) — o rate limit do Supabase
  // Auth para `resetPasswordForEmail` é POR USUÁRIO: só dispara para um
  // e-mail que TEM conta. Antes desta correção, o ramo de erro devolvia
  // `error.message` cru: repetir o pedido em menos de 60s para um e-mail
  // cadastrado gerava "For security purposes, you can only request this
  // after N seconds" na TELA, enquanto um e-mail não cadastrado nunca gera
  // esse erro (resolve sempre "success"). Dois pedidos ao mesmo endereço já
  // reabriam a enumeração que a issue #120 fechou. A mensagem devolvida ao
  // chamador tem que ser genérica — o detalhe do servidor vai só para
  // `console.error`.
  it("3. duas falhas diferentes do servidor (rate limit vs erro de rede) devolvem a MESMA mensagem genérica, sem repetir o texto do servidor", async () => {
    const { supabase, resetPassword } = await montar();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    (supabase.auth.resetPasswordForEmail as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        data: null,
        error: {
          message:
            "For security purposes, you can only request this after 58 seconds.",
          status: 429,
        },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Network request failed", status: 500 },
      });

    let rateLimit: ResetPasswordResult;
    let generico: ResetPasswordResult;
    await act(async () => {
      rateLimit = await resetPassword("alvo@example.com");
      generico = await resetPassword("alvo@example.com");
    });

    expect(rateLimit!.status).toBe("error");
    expect(rateLimit!.message).toBe(generico!.message);
    expect(rateLimit!.message).not.toMatch(/security purposes|seconds/i);
    expect(rateLimit!.message).not.toMatch(/network request failed/i);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
