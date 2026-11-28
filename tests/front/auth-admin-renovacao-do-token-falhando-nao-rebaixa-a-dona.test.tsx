// @vitest-environment jsdom
//
// Renovação do token falhando não rebaixa a lojista (caça 28/11/2026).
//
// Quando a renovação do token falha por rede (AuthRetryableFetchError), o
// auth-js 2.117 guarda a falha por 60 s (`REFRESH_FAILURE_COOLDOWN_MS`) e,
// nesse tempo, `getSession()` devolve `session: null` com o erro. O supabase-js
// então manda a CHAVE ANÔNIMA no lugar do token da lojista, e a RPC `is_admin`
// responde `false` — não porque ela perdeu o papel, mas porque o servidor não
// sabe quem pergunta. Antes, esse "não" falso passava por `applyResult(false)`:
// o painel trocava por "Acesso restrito", o atalho `ikcous_is_admin_<uid>`
// virava "false" e o catálogo de lojista saía do aparelho.
//
// Regra que estes testes prendem: um "não" só vale com a sessão comprovadamente
// da mesma pessoa (antes E depois da pergunta). Sem isso, é falha de rede: nada
// promove, nada rebaixa, nada se grava; o próximo TOKEN_REFRESHED/SIGNED_IN da
// mesma conta pergunta de novo. Um "não" com a sessão dela rebaixa na hora, e a
// troca de conta e a saída continuam limpando tudo.
//
// Harness copiado de auth-admin-recheca-de-fundo-nao-rebaixa-a-dona.test.tsx;
// a diferença é que aqui `getSession` responde o que o teste mandar.
import type { AdminStatus } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
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
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  isAdmin: boolean;
  adminStatus: AdminStatus;
  adminVerificacaoFalhou: boolean;
  userId: string | null;
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
    isAdmin: boolean;
    adminStatus: AdminStatus;
    adminVerificacaoFalhou: boolean;
    user: { id: string } | null;
  };
  aoAtualizar({
    isAdmin: ctx.isAdmin,
    adminStatus: ctx.adminStatus,
    adminVerificacaoFalhou: ctx.adminVerificacaoFalhou,
    userId: ctx.user?.id ?? null,
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

type Pendente = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

function sessaoDe(userId: string) {
  return {
    user: { id: userId, app_metadata: {} },
    access_token: `tok-${userId}`,
  };
}

type RespostaDaSessao = { data: { session: unknown }; error: unknown };

/** O que o auth-js devolve na janela de 60 s depois de a renovação falhar. */
function renovacaoFalhando(): RespostaDaSessao {
  return {
    data: { session: null },
    error: new AuthRetryableFetchError("Failed to fetch", 0),
  };
}

function sessaoValidaDe(userId: string): RespostaDaSessao {
  return { data: { session: sessaoDe(userId) }, error: null };
}

const rpcMock = () => supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const fromMock = () => supabase.from as unknown as ReturnType<typeof vi.fn>;
const getSessionMock = () =>
  supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

const chamadasIsAdmin = () =>
  rpcMock().mock.calls.filter(([nome]) => nome === "is_admin").length;

describe("AuthContext — 'não' da chave anônima (renovação do token falhando) não rebaixa a lojista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // O que `getSession()` responde agora. Começa sem sessão (boot).
  let sessaoAgora: RespostaDaSessao;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    sessaoAgora = { data: { session: null }, error: null };
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
    vi.useRealTimers();
  });

  async function montar() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    getSessionMock().mockImplementation(() => Promise.resolve(sessaoAgora));
    let callback: AuthChangeCallback = () => {};
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: AuthChangeCallback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const fila: Pendente[] = [];
    rpcMock().mockImplementation((nome: string) => {
      if (nome === "is_admin") {
        return new Promise((resolve, reject) => {
          fila.push({ resolve, reject });
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    // Plano B em `profiles`: como anônimo a linha não aparece (erro).
    fromMock().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: null, error: { message: "PGRST116" } }),
        }),
      }),
    }));
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
    return { cb: () => callback, fila, aoAtualizar };
  }

  async function entrarComoDona(userId = "dona") {
    const ctx = await montar();
    sessaoAgora = sessaoValidaDe(userId);
    await act(async () => {
      ctx.cb()("SIGNED_IN", sessaoDe(userId));
      await esperarMicrotarefas();
    });
    ctx.fila[0].resolve({ data: true, error: null });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(localStorage.getItem(`ikcous_is_admin_${userId}`)).toBe("true");
    return ctx;
  }

  async function disparar(
    ctx: { cb: () => AuthChangeCallback },
    evento: string,
    sessao: unknown,
  ) {
    await act(async () => {
      ctx.cb()(evento, sessao);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("1. renovação falhando + is_admin 'false' (chave anônima): a lojista continua no painel e o atalho fica 'true'", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    sessaoAgora = renovacaoFalhando();
    await disparar(ctx, "SIGNED_IN", sessaoDe("dona"));
    ctx.fila[1].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(ultimoEstado(ctx.aoAtualizar)?.isAdmin).toBe(true);
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  it("1b. primeira checagem da carga (sem confirmação) com a renovação falhando: não expulsa, não grava 'false', oferece 'Tentar de novo'", async () => {
    const ctx = await montar();
    vi.useFakeTimers();
    localStorage.setItem("ikcous_is_admin_dona", "true");

    sessaoAgora = renovacaoFalhando();
    await disparar(ctx, "SIGNED_IN", sessaoDe("dona"));
    ctx.fila[0].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("unknown");
    expect(ultimoEstado(ctx.aoAtualizar)?.isAdmin).toBe(false);
    expect(ultimoEstado(ctx.aoAtualizar)?.adminVerificacaoFalhou).toBe(true);
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  it("1c. sessão falhando ANTES da pergunta e de volta DEPOIS (renovou no meio): o 'false' continua sem valer", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    sessaoAgora = renovacaoFalhando();
    await disparar(ctx, "SIGNED_IN", sessaoDe("dona"));
    // A pergunta saiu com a chave anônima; antes de a resposta chegar a
    // renovação deu certo (outra aba, ou a janela de 60 s acabou).
    sessaoAgora = sessaoValidaDe("dona");
    ctx.fila[1].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  it("1e. sessão válida ANTES da pergunta e falhando DEPOIS (a renovação caiu no caminho): o 'false' não vale", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    await disparar(ctx, "TOKEN_REFRESHED", sessaoDe("dona"));
    // A renovação falhou entre a leitura de antes e a pergunta: o supabase-js
    // pode ter mandado a chave anônima.
    sessaoAgora = renovacaoFalhando();
    ctx.fila[1].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  it("1f. plano B em `profiles` dizendo outro papel com a renovação falhando também não rebaixa", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();
    fromMock().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: { role: "customer" }, error: null }),
        }),
      }),
    }));

    sessaoAgora = renovacaoFalhando();
    await disparar(ctx, "SIGNED_IN", sessaoDe("dona"));
    ctx.fila[1].resolve({ data: null, error: { message: "rpc fora do ar" } });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  it("1d. 'false' com a sessão de OUTRA conta no cliente: não rebaixa quem está na tela", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    sessaoAgora = sessaoValidaDe("outra");
    await disparar(ctx, "TOKEN_REFRESHED", sessaoDe("dona"));
    ctx.fila[1].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  it("2. depois chega TOKEN_REFRESHED da mesma conta e is_admin diz 'true': segue lojista, com UMA releitura", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    sessaoAgora = renovacaoFalhando();
    await disparar(ctx, "SIGNED_IN", sessaoDe("dona"));
    ctx.fila[1].resolve({ data: false, error: null });
    await avancar(0);
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");

    const antes = chamadasIsAdmin();
    sessaoAgora = sessaoValidaDe("dona");
    await disparar(ctx, "TOKEN_REFRESHED", sessaoDe("dona"));
    expect(chamadasIsAdmin()).toBe(antes + 1);
    ctx.fila[2].resolve({ data: true, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(ultimoEstado(ctx.aoAtualizar)?.adminVerificacaoFalhou).toBe(false);
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
    await avancar(5000);
    expect(chamadasIsAdmin()).toBe(antes + 1);
  });

  it("2b. o 'não' que chega DEPOIS que a sessão voltou rebaixa: perder o papel de verdade não fica escondido", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    sessaoAgora = renovacaoFalhando();
    await disparar(ctx, "SIGNED_IN", sessaoDe("dona"));
    ctx.fila[1].resolve({ data: false, error: null });
    await avancar(0);
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");

    sessaoAgora = sessaoValidaDe("dona");
    await disparar(ctx, "TOKEN_REFRESHED", sessaoDe("dona"));
    ctx.fila[2].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("false");
  });

  it("3. controle: is_admin 'false' com a sessão válida da mesma conta rebaixa na hora", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    await disparar(ctx, "TOKEN_REFRESHED", sessaoDe("dona"));
    ctx.fila[1].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(ultimoEstado(ctx.aoAtualizar)?.isAdmin).toBe(false);
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("false");
  });

  it("4. troca de conta durante a janela: a outra conta nunca vira lojista, nem pelo 'sim' atrasado da anterior", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    sessaoAgora = renovacaoFalhando();
    await disparar(ctx, "SIGNED_IN", sessaoDe("dona"));
    // Outra pessoa entra no mesmo aparelho antes de a resposta chegar.
    sessaoAgora = sessaoValidaDe("cliente");
    await disparar(ctx, "SIGNED_IN", sessaoDe("cliente"));
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBeNull();

    // A resposta atrasada da dona ("sim") e a da cliente ("não").
    ctx.fila[1].resolve({ data: true, error: null });
    ctx.fila[2].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.userId).toBe("cliente");
    expect(ultimoEstado(ctx.aoAtualizar)?.isAdmin).toBe(false);
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(localStorage.getItem("ikcous_is_admin_cliente")).toBe("false");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBeNull();
  });

  it("4b. troca de conta com a renovação AINDA falhando: a cliente fica sem acesso (nunca herda o da dona)", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    sessaoAgora = renovacaoFalhando();
    await disparar(ctx, "SIGNED_IN", sessaoDe("cliente"));
    ctx.fila[1].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.userId).toBe("cliente");
    expect(ultimoEstado(ctx.aoAtualizar)?.isAdmin).toBe(false);
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("unknown");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBeNull();
  });

  it("4c. SIGNED_OUT durante a janela: limpa tudo e a resposta atrasada não devolve o acesso", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    sessaoAgora = renovacaoFalhando();
    await disparar(ctx, "SIGNED_IN", sessaoDe("dona"));
    sessaoAgora = { data: { session: null }, error: null };
    await disparar(ctx, "SIGNED_OUT", null);
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBeNull();

    ctx.fila[1].resolve({ data: true, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.userId).toBeNull();
    expect(ultimoEstado(ctx.aoAtualizar)?.isAdmin).toBe(false);
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBeNull();
  });
});
