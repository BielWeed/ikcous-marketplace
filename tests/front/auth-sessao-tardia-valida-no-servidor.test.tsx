// @vitest-environment jsdom
//
// R-1 do laudo de varredura profunda (01/09): o caminho da SESSÃO TARDIA
// (PR #384 — a resposta do getSession que chega depois do timeout de 3s do
// boot) aplicava a sessão do cache local SEM a validação no servidor que o
// caminho normal faz (AuthContext, ramo de `initSes`): lá, `getUser()`
// respondendo 403/"not found"/"Invalid token" força signOut; falha de REDE
// não desloga (CONTA-02). Efeito: token revogado durante um boot lento
// mostra usuário logado para sempre — o estado do cliente mente.
//
// O conserto: depois de aplicar a sessão tardia, a MESMA verificação roda
// em background (sem bloquear o boot), com os MESMOS critérios do caminho
// normal. O caminho normal não muda (ele já é coberto por
// auth-boot-verificacao-de-rede-nao-desloga.test.tsx).
//
// Mesmo harness de auth-sessao-tardia-no-boot-nao-se-perde.test.tsx:
// supabase dublê estático + `vi.resetModules()` (initPromise é variável de
// módulo) + sonda que reporta o contexto por callback + timers falsos.
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
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
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
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

describe("AuthContext — a sessão tardia valida no servidor em background", () => {
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

    // Listener registrado mas SILENCIOSO (o conserto da sessão tardia não
    // depende de evento nenhum do supabase).
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

  /** Leva o teste ao ponto em que a resposta tardia do getSession chegou e
   * foi processada: o timeout do boot venceu (3s) e a sessão foi aplicada —
   * a validação em background (o conserto R-1) resolve no MESMO flush de
   * microtasks (o dublê não tem latência de rede), então o estado final já
   * é observável depois daqui, e NÃO se assera o estado intermediário
   * "aplicado e ainda não validado": ele não é observável num dublê
   * instantâneo. */
  async function aplicarSessaoTardia() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      resolverGetSession({
        data: {
          session: {
            access_token: "tok-1",
            user: { id: "user-tardio" },
          },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  /** Limpa o HISTÓRICO dos dublês (não só as implementações): as chamadas
   * de um teste não podem contaminar a asserção do seguinte — o
   * restoreAllMocks do afterEach devolve implementações, mas o histórico de
   * `mock.calls` dos vi.fn do factory precisa ser zerado aqui, por teste. */
  function limparHistoricoDosDoubles() {
    (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockClear();
    (supabase.auth.signOut as ReturnType<typeof vi.fn>).mockClear();
  }

  it("getUser responde 'Invalid token': a sessão tardia é DESLOGADA (signOut)", async () => {
    limparHistoricoDosDoubles();
    (
      supabase.auth.getUser as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: null },
      error: {
        message: "Invalid token: JWT has expired",
        status: 401,
      },
    });

    await montar();
    await aplicarSessaoTardia();

    // A validação em background responde: token inválido → desloga.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(snapshotAtual().userId).toBeNull();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it("getUser responde 'not found' (403 do servidor): idem — desloga", async () => {
    limparHistoricoDosDoubles();
    (
      supabase.auth.getUser as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: null },
      error: { message: "User from sub claim in JWT does not exist", status: 403 },
    });

    await montar();
    await aplicarSessaoTardia();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(snapshotAtual().userId).toBeNull();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it("getUser FALHA POR REDE (AuthRetryableFetchError): continua logado — CONTA-02", async () => {
    limparHistoricoDosDoubles();
    (
      supabase.auth.getUser as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("Service Unavailable", 502),
    });

    await montar();
    await aplicarSessaoTardia();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(snapshotAtual().userId).toBe("user-tardio");
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("getUser FALHA POR RATE LIMIT (AuthApiError 429): continua logado — CONTA-02b", async () => {
    limparHistoricoDosDoubles();
    (
      supabase.auth.getUser as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        "Too many requests",
        429,
        "over_request_rate_limit",
      ),
    });

    await montar();
    await aplicarSessaoTardia();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(snapshotAtual().userId).toBe("user-tardio");
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("getUser OK: continua logado (e a validação não derruba ninguém)", async () => {
    limparHistoricoDosDoubles();
    (
      supabase.auth.getUser as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: { id: "user-tardio" } },
      error: null,
    });

    await montar();
    await aplicarSessaoTardia();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(snapshotAtual().userId).toBe("user-tardio");
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });
});
