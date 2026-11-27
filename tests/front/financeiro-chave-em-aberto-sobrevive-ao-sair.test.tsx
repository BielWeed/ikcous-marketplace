// @vitest-environment jsdom
//
// A chave anti-repetição de um lançamento do Financeiro que ficou "pode ter
// sido salvo" (src/components/admin/financeiro/tentativasEmAberto.ts) é de quem
// lançou e SOBREVIVE ao "Sair": a lojista com rede ruim que salva, vê "pode ter
// sido salvo", sai (até com o `signOut()` falhando) e entra de novo na mesma aba
// reaproveita a chave — salvar igual não duplica o lançamento. Outra conta que
// entra na aba nunca a herda (o dono vai gravado junto da chave), e o prazo de
// 10 minutos continua valendo para quem volta.
//
// Andaime: o MESMO de checkout-recibo-limpa-no-logout.test.tsx.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveEmAbertoDoConteudo,
  guardarChaveEmAberto,
} from "@/components/admin/financeiro/tentativasEmAberto";

const CONTEUDO = JSON.stringify({ descricao: "Aluguel", valor: 120 });
const ARMAZEM = "fin-lancamento-tentativas-em-aberto";
const DEZ_MINUTOS = 10 * 60_000;
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
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function criarArmazemFake() {
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

describe("chave em aberto do Financeiro — sobrevive ao Sair, só para quem lançou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarArmazemFake());
    vi.stubGlobal("sessionStorage", criarArmazemFake());
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

  it("SIGNED_OUT e a mesma conta volta: reaproveita a chave (não duplica)", async () => {
    const { callback, aoAtualizar } = await montarLogado();
    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-a");
    guardarChaveEmAberto("user-a", CONTEUDO, "chave-da-a");

    await act(async () => {
      callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });
    expect(ultimoEstado(aoAtualizar)?.userId).toBeNull();
    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-a");
    expect(chaveEmAbertoDoConteudo("user-a", CONTEUDO)).toBe("chave-da-a");
  });

  it("logout() com signOut() falhando (rede caída) não toca nas chaves; a mesma conta volta e reaproveita", async () => {
    const { callback, aoAtualizar } = await montarLogado();
    const { supabase } = await import("@/lib/supabase");
    guardarChaveEmAberto("user-a", CONTEUDO, "chave-da-a");
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });
    const armazem = sessionStorage as unknown as {
      setItem: (k: string, v: string) => void;
      removeItem: (k: string) => void;
    };
    const escreverNasChaves = vi.fn();
    const setItem = armazem.setItem;
    const removeItem = armazem.removeItem;
    armazem.setItem = (k, v) => {
      if (k === ARMAZEM) escreverNasChaves("setItem");
      setItem(k, v);
    };
    armazem.removeItem = (k) => {
      if (k === ARMAZEM) escreverNasChaves("removeItem");
      removeItem(k);
    };

    const estado = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });
    expect(ultimoEstado(aoAtualizar)?.userId).toBeNull();
    expect(escreverNasChaves).not.toHaveBeenCalled();

    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });
    expect(chaveEmAbertoDoConteudo("user-a", CONTEUDO)).toBe("chave-da-a");
  });

  it("outra conta que entra na mesma aba depois do Sair não herda a chave", async () => {
    const { callback, aoAtualizar } = await montarLogado();
    guardarChaveEmAberto("user-a", CONTEUDO, "chave-da-a");

    await act(async () => {
      callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });
    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-b");
    expect(chaveEmAbertoDoConteudo("user-b", CONTEUDO)).toBeNull();
    // A chave continua da A, só dela.
    expect(chaveEmAbertoDoConteudo("user-a", CONTEUDO)).toBe("chave-da-a");
  });

  it("quem volta depois dos 10 minutos já não reaproveita: o prazo continua valendo", async () => {
    const { callback } = await montarLogado();
    const agora = Date.now();
    const relogio = vi.spyOn(Date, "now").mockReturnValue(agora);
    guardarChaveEmAberto("user-a", CONTEUDO, "chave-da-a");

    await act(async () => {
      callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });
    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    relogio.mockReturnValue(agora + DEZ_MINUTOS);
    expect(chaveEmAbertoDoConteudo("user-a", CONTEUDO)).toBe("chave-da-a");
    relogio.mockReturnValue(agora + DEZ_MINUTOS + 1);
    expect(chaveEmAbertoDoConteudo("user-a", CONTEUDO)).toBeNull();
  });
});
