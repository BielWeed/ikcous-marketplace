// @vitest-environment jsdom
//
// O boot abre a tela com a conta A (vinda do cache local) e confere A no
// servidor em segundo plano (`getUser()`, AuthContext.tsx, dentro de
// `initAuth`). Se a rede está lenta, a pessoa pode sair — ou entrar na conta
// B — ANTES dessa conferência responder. Quando a resposta de A chegava,
// o código reaplicava sessão e usuário de A sem olhar quem estava ativo: a
// interface voltava à conta que a pessoa tinha acabado de deixar (e o ramo de
// "token inválido" ainda deslogava a conta B, que não tinha nada a ver).
//
// A correção reusa a guarda que o arquivo já tem em `fetchProfile`/`checkAdmin`
// (`activeUserIdRef.current !== <conta que perguntou>` → descarta): a resposta
// do boot só vale se a conta que a perguntou ainda é a ativa.
//
// Mesmo harness de auth-boot-verificacao-de-rede-nao-desloga.test.tsx.
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
  sessionUserId: string | null;
  userId: string | null;
  email: string | null;
}

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as {
    session: { user: { id: string } } | null;
    user: { id: string; email?: string } | null;
  };
  aoAtualizar({
    sessionUserId: ctx.session?.user?.id ?? null,
    userId: ctx.user?.id ?? null,
    email: ctx.user?.email ?? null,
  });
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
    user: {
      id: userId,
      app_metadata: {},
      email: `${userId}@cache.fixture.invalid`,
    },
    access_token: `tok-${userId}`,
  };
}

type RespostaGetUser = {
  data: { user: { id: string; email?: string } | null };
  error: { status?: number; message: string } | null;
};

describe("AuthContext — a resposta atrasada do boot não restaura a conta anterior", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let callbackAuth: ((event: string, session: unknown) => unknown) | undefined;
  let responderGetUser: (resposta: RespostaGetUser) => void;
  let aoAtualizar: ReturnType<typeof vi.fn<(snapshot: Snapshot) => void>>;
  let supabaseMock: any;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    aoAtualizar = vi.fn<(snapshot: Snapshot) => void>(() => {});
    callbackAuth = undefined;
    responderGetUser = () => {};
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

  /** Monta o provider com a conta A no cache e `getUser()` PENDURADO: a
   * resposta só sai quando o teste chama `responderGetUser`. */
  async function montarComBootPendurado() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");
    supabaseMock = supabase;

    supabase.auth.getSession = vi.fn().mockResolvedValue({
      data: { session: sessaoDe("conta-a") },
      error: null,
    });
    supabase.auth.getUser = vi.fn().mockImplementation(
      () =>
        new Promise<RespostaGetUser>((resolve) => {
          responderGetUser = resolve;
        }),
    );
    supabase.auth.onAuthStateChange = vi
      .fn()
      .mockImplementation(
        (cb: (event: string, session: unknown) => unknown) => {
          callbackAuth = cb;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      );
    supabase.auth.signOut = vi.fn().mockResolvedValue({ error: null });
    supabase.rpc = vi.fn().mockResolvedValue({ data: null, error: null });

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  function emitir(evento: string, sessao: unknown) {
    return act(async () => {
      await callbackAuth?.(evento, sessao);
      await esperarMicrotarefas();
    });
  }

  function responder(resposta: RespostaGetUser) {
    return act(async () => {
      responderGetUser(resposta);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  function atual(): Snapshot {
    return aoAtualizar.mock.calls.at(-1)![0] as Snapshot;
  }

  it("1. sair (SIGNED_OUT) com a conferência pendente: a resposta de A não traz A de volta", async () => {
    await montarComBootPendurado();
    // O boot hidratou A do cache; a conferência ainda não respondeu.
    expect(atual().userId).toBe("conta-a");

    await emitir("SIGNED_OUT", null);
    expect(atual().userId).toBeNull();

    await responder({
      data: { user: { id: "conta-a", email: "a@servidor.fixture.invalid" } },
      error: null,
    });

    expect(atual().userId).toBeNull();
    expect(atual().sessionUserId).toBeNull();
  });

  it("2. entrar na conta B com a conferência pendente: a resposta de A não derruba B", async () => {
    await montarComBootPendurado();

    await emitir("SIGNED_IN", sessaoDe("conta-b"));
    expect(atual().userId).toBe("conta-b");

    await responder({
      data: { user: { id: "conta-a", email: "a@servidor.fixture.invalid" } },
      error: null,
    });

    expect(atual().userId).toBe("conta-b");
    expect(atual().sessionUserId).toBe("conta-b");
  });

  it("3. resposta atrasada de 'token inválido' de A (403) não desloga a conta B que entrou no meio", async () => {
    await montarComBootPendurado();

    await emitir("SIGNED_IN", sessaoDe("conta-b"));
    supabaseMock.auth.signOut.mockClear();

    await responder({
      data: { user: null },
      error: { status: 403, message: "Forbidden" },
    });

    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
    expect(atual().userId).toBe("conta-b");
    expect(atual().sessionUserId).toBe("conta-b");
  });

  it("4. controle — boot normal, sem evento no meio: a resposta é aplicada (usuário confirmado pelo servidor)", async () => {
    await montarComBootPendurado();
    expect(atual().email).toBe("conta-a@cache.fixture.invalid");

    await responder({
      data: { user: { id: "conta-a", email: "a@servidor.fixture.invalid" } },
      error: null,
    });

    expect(atual().userId).toBe("conta-a");
    expect(atual().sessionUserId).toBe("conta-a");
    // O usuário aplicado é o que o SERVIDOR devolveu (metadados frescos).
    expect(atual().email).toBe("a@servidor.fixture.invalid");
  });

  it("5. controle — a MESMA conta A reanunciada no meio (SIGNED_IN do navegador): a resposta continua valendo", async () => {
    await montarComBootPendurado();

    await emitir("SIGNED_IN", sessaoDe("conta-a"));

    await responder({
      data: { user: { id: "conta-a", email: "a@servidor.fixture.invalid" } },
      error: null,
    });

    expect(atual().userId).toBe("conta-a");
    expect(atual().email).toBe("a@servidor.fixture.invalid");
  });

  it("6. controle — sem evento no meio, resposta 'sem usuário' (sessão morta) continua deslogando", async () => {
    await montarComBootPendurado();

    await responder({ data: { user: null }, error: null });

    expect(supabaseMock.auth.signOut).toHaveBeenCalledTimes(1);
  });
});
