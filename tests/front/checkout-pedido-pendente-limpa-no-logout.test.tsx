// @vitest-environment jsdom
//
// O PIX PENDENTE SOBREVIVE À RECARGA (04/10/2026) — e MORRE no logout. O
// registro da aba (SÓ o id do pedido em pagamento, por usuário — ver
// src/lib/pedido-pendente-do-checkout.ts) é dado da sessão de quem saiu: o
// logout apaga, nos dois caminhos de saída (`SIGNED_OUT` e o `logout()` com
// o `signOut()` falhando), pela MESMA `clearLocalUserData` que já limpa o
// resto do dado local da conta.
//
// Andaime: o MESMO de admin-cache-limpa-no-logout.test.tsx.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  guardarPedidoPendenteDoCheckout,
  lerPedidoPendenteDoCheckout,
} from "@/lib/pedido-pendente-do-checkout";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// auth-logout-cleanup.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  userId: string | null;
  logout: () => Promise<void>;
}

type AuthChangeCallback = (
  event: string,
  session: unknown,
) => void | Promise<void>;

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as {
    user: { id: string } | null;
    logout: () => Promise<void>;
  };
  aoAtualizar({
    userId: ctx.user?.id ?? null,
    logout: ctx.logout,
  });
  return null;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  const chamadas = aoAtualizar.mock.calls;
  return chamadas.at(-1)?.[0];
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno de
// auth-logout-cleanup.test.tsx.
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

function sessaoDe(userId: string) {
  return {
    user: { id: userId, app_metadata: {} },
    access_token: `tok-${userId}`,
  };
}

describe("registro do pedido pendente do checkout — limpo no logout", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    vi.stubGlobal("sessionStorage", criarLocalStorageFake());
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

  async function montarLogado() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    let callback: AuthChangeCallback = () => {};
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: AuthChangeCallback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

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
    await act(async () => {
      callback("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    return { callback: () => callback, aoAtualizar };
  }

  it("SIGNED_OUT apaga o registro do pedido pendente", async () => {
    const { callback, aoAtualizar } = await montarLogado();
    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-a");
    guardarPedidoPendenteDoCheckout("user-a", PEDIDO);
    expect(lerPedidoPendenteDoCheckout("user-a")).toBe(PEDIDO);

    const cb = callback();
    await act(async () => {
      cb("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    expect(lerPedidoPendenteDoCheckout("user-a")).toBeNull();
  });

  it("logout() com signOut() falhando (rede caída) também apaga o registro", async () => {
    const { aoAtualizar } = await montarLogado();
    const { supabase } = await import("@/lib/supabase");
    guardarPedidoPendenteDoCheckout("user-a", PEDIDO);
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const estado = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });

    expect(lerPedidoPendenteDoCheckout("user-a")).toBeNull();
  });
});
