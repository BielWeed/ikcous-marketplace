// @vitest-environment jsdom
//
// O "Agora não" do cartão de avisos do Início (7 dias) é do APARELHO, no nome
// de quem o tocou. Depois de Sair e Entrar o aparelho já foi descadastrado da
// conta — que é exatamente o caso que o cartão existe para pegar. Se o
// adiamento sobrevivesse ao Sair, o alarme ficaria calado por até 7 dias.
//
// Aqui se trava a parte do AuthContext: o adiamento é zerado no MESMO ponto em
// que o app descadastra o aparelho da conta — o Sair, o fim de sessão vindo de
// fora (outra aba, sessão vencida) e a troca direta de conta (A -> B) —, e o
// SIGNED_IN que o navegador reemite para a MESMA conta não zera nada (o
// controle: um "zera sempre" também passaria nos três primeiros).
//
// Mesmo andaime de auth-sair-cancela-push-da-conta.test.tsx.
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
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }),
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

type AuthChangeCallback = (
  event: string,
  session: unknown,
) => void | Promise<void>;

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (logout: () => Promise<void>) => void;
}) {
  const ctx = useContext(authContext) as { logout: () => Promise<void> };
  aoAtualizar(ctx.logout);
  return null;
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

function sessaoDe(userId: string) {
  return {
    user: { id: userId, app_metadata: {} },
    access_token: `tok-${userId}`,
  };
}

const ADIADO_ATE = String(Date.now() + 7 * 24 * 60 * 60 * 1000);

describe("AuthContext — Sair e troca de conta zeram o adiamento do cartão de avisos", () => {
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

  async function montarLogado() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");
    const { CHAVE_DO_ADIAMENTO_DOS_AVISOS, lerAdiamentoDosAvisos } =
      await import("@/lib/avisos-do-aparelho");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });
    let callback: AuthChangeCallback = () => {};
    // O supabase-js de verdade dispara SIGNED_OUT ao terminar o signOut: é
    // esse evento que roda a limpeza local no caminho de sucesso do Sair.
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(async () => {
      await callback("SIGNED_OUT", null);
      return { error: null };
    });

    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: AuthChangeCallback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    let logout: () => Promise<void> = async () => {};
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda
            authContext={AuthContext}
            aoAtualizar={(fn) => {
              logout = fn;
            }}
          />
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

    // A lojista tocou "Agora não" neste aparelho.
    localStorage.setItem(CHAVE_DO_ADIAMENTO_DOS_AVISOS, ADIADO_ATE);
    expect(lerAdiamentoDosAvisos()).toBe(Number(ADIADO_ATE));

    return {
      callback: () => callback,
      sair: () => logout(),
      adiamento: lerAdiamentoDosAvisos,
    };
  }

  it("1. o Sair zera o adiamento: depois de Sair e Entrar o cartão volta", async () => {
    const { sair, callback, adiamento } = await montarLogado();

    await act(async () => {
      await sair();
    });
    expect(adiamento()).toBeNull();

    // Entrar de novo (a mesma pessoa, ou outra): nada de adiamento voltou.
    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });
    expect(adiamento()).toBeNull();
  });

  it("2. o fim da sessão vindo de fora (SIGNED_OUT) zera o adiamento", async () => {
    const { callback, adiamento } = await montarLogado();

    await act(async () => {
      callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    expect(adiamento()).toBeNull();
  });

  it("3. troca direta de conta (A -> B, sem SIGNED_OUT) zera o adiamento", async () => {
    const { callback, adiamento } = await montarLogado();

    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    expect(adiamento()).toBeNull();
  });

  it("4. o SIGNED_IN reemitido para a MESMA conta (voltar à aba) NÃO zera o adiamento", async () => {
    const { callback, adiamento } = await montarLogado();

    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });
    await act(async () => {
      callback()("TOKEN_REFRESHED", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    expect(adiamento()).toBe(Number(ADIADO_ATE));
  });
});
