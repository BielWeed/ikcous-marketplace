// @vitest-environment jsdom
//
// Defeito reportado pelo Gabriel em 01/09: logado, a Home mostrava o banner
// "Faça login para ganhar frete grátis / ENTRAR" — o estado de DESLOGADO —
// até ele mexer no carrinho.
//
// O mecanismo: no boot, `initAuth` corre `supabase.auth.getSession()` contra
// um timeout de 3s (proteção contra pendura no celular). Quando a rede está
// lenta, o TIMEOUT ganha e o ramo do `return` saía DESCARTANDO a sessão que
// ainda estava a caminho: `user` ficava null e nada mais o aplicava — só um
// re-render qualquer (ex.: mudança no carrinho) refletia o user quando o
// listener o aplicava tarde.
//
// Este teste prende o conserto em DOIS lados:
// 1. a sessão que chega DEPOIS do timeout é aplicada (com o listener mudo —
//    é o caminho exato em que o app do Gabriel ficou preso);
// 2. a resposta tardia é VELHA: se um usuário diferente já foi aplicado
//    (login novo no meio do caminho), ela não derruba quem está ativo.
//
// Mesmo harness de auth-admin-check.test.tsx: supabase dublê estático +
// `vi.resetModules()` só para o AuthContext (initPromise é variável de
// módulo) + sonda que reporta o contexto por callback.
import { supabase } from "@/lib/supabase";
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      // R-1 (laudo varredura 01/09): a sessão tardia passou a VALIDAR no
      // servidor em background — o dublê responde confirmando a sessão
      // (`user` presente, sem erro), que é o cenário deste arquivo ("a rede
      // demorou, mas a sessão é boa"). Antes do R-1 o getUser nem era
      // chamado neste caminho; devolver `user: null` aqui faria a validação
      // honesta deslogar a sessão que este teste quer ver aplicada.
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "user-tardio" } }, error: null }),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: null, error: { message: "sem perfil" } }),
        }),
      }),
    })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  userId: string | null;
  loading: boolean;
}

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as {
    user: { id: string } | null;
    loading: boolean;
  };
  aoAtualizar({ userId: ctx.user?.id ?? null, loading: ctx.loading });
  return null;
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

describe("AuthContext — a sessão que chega depois do timeout do boot é aplicada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let resolverGetSession: (valor: unknown) => void;
  let callbacksAuth: Array<(event: string, session: unknown) => unknown>;
  let aoAtualizar: ReturnType<typeof vi.fn<(snapshot: Snapshot) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    aoAtualizar = vi.fn<(snapshot: Snapshot) => void>(() => {});
    callbacksAuth = [];

    // getSession pendura até o teste resolver — a rede lenta do celular.
    resolverGetSession = () => {};
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolverGetSession = resolve;
        }),
    );

    // Listener registrado mas SILENCIOSO por padrão (o teste decide quando
    // emitir): o conserto não pode depender de evento nenhum do supabase —
    // é exatamente o caso em que ele não chega.
    (
      supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>
    ).mockImplementation(
      (callback: (event: string, session: unknown) => unknown) => {
        callbacksAuth.push(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    );

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function montar() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    function Arvore() {
      return (
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>
      );
    }
    await act(async () => {
      raiz.render(<Arvore />);
    });
  }

  function snapshotAtual(): Snapshot {
    return aoAtualizar.mock.calls.at(-1)![0] as Snapshot;
  }

  it("getSession perde a corrida de 3s e a sessão chega depois: o usuário é aplicado", async () => {
    await montar();

    // O timeout do boot vence: user null, carregando liberado — é o estado
    // que o Gabriel viu (banner de deslogado com usuário logado).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(snapshotAtual().userId).toBeNull();
    expect(snapshotAtual().loading).toBe(false);

    // A rede responde DEPOIS (a promise do getSession continua viva).
    await act(async () => {
      resolverGetSession({
        data: {
          session: { access_token: "tok-1", user: { id: "user-tardio" } },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(snapshotAtual().userId).toBe("user-tardio");
  });

  it("a resposta tardia é VELHA: não derruba usuário diferente já ativo", async () => {
    await montar();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Um SIGNED_IN de verdade chegou pelo listener (login novo) e aplicou
    // outro usuário enquanto a resposta do boot ainda ia no caminho.
    await act(async () => {
      for (const callback of callbacksAuth) {
        void callback("SIGNED_IN", {
          access_token: "tok-2",
          user: { id: "user-novo" },
        });
      }
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(snapshotAtual().userId).toBe("user-novo");

    // Agora a resposta TARDIA do boot chega, com o usuário ANTIGO: ela não
    // pode derrubar o login novo.
    await act(async () => {
      resolverGetSession({
        data: {
          session: { access_token: "tok-1", user: { id: "user-tardio" } },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(snapshotAtual().userId).toBe("user-novo");
  });
});
