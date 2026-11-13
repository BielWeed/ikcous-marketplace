// @vitest-environment jsdom
//
// O PAINEL ABRE COM O ARMAZENAMENTO DO NAVEGADOR BLOQUEADO (caça, r438-a).
//
// Chrome com "Bloquear todos os cookies e dados de sites" e política de
// empresa fazem o próprio ACESSO a `localStorage` lançar SecurityError. O
// AuthContext lia e gravava o atalho "é lojista?" (`ikcous_is_admin_<uid>`)
// fora de qualquer try: a exceção morria na promessa da checagem, o painel
// ficava "carregando" para sempre e nem o "Tentar de novo" aparecia. E, mesmo
// quando o servidor respondia "sim", a GRAVAÇÃO do atalho lançava depois de o
// estado virar admin e o `catch` da checagem rebaixava a lojista para
// "não consegui verificar".
//
// Regras que estes testes prendem:
//  - armazenamento ilegível = "sem atalho": cai para a pergunta ao servidor;
//  - o servidor continua sendo a ÚNICA fonte do "sim" (o atalho nunca promove);
//  - sem armazenamento, o "Sair" e a troca direta de conta terminam de limpar
//    o que dá (memória) e a tela destrava.
//
// Harness copiado de auth-admin-recheca-de-fundo-nao-rebaixa-a-dona.test.tsx.
import type { AdminStatus } from "@/contexts/AuthContext";
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
  loading: boolean;
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
    isAdmin: boolean;
    adminStatus: AdminStatus;
    adminVerificacaoFalhou: boolean;
    user: { id: string } | null;
    loading: boolean;
    logout: () => Promise<void>;
  };
  aoAtualizar({
    isAdmin: ctx.isAdmin,
    adminStatus: ctx.adminStatus,
    adminVerificacaoFalhou: ctx.adminVerificacaoFalhou,
    userId: ctx.user?.id ?? null,
    loading: ctx.loading,
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

function criarLocalStorageFake(inicial: Record<string, string> = {}) {
  const armazem = new Map<string, string>(Object.entries(inicial));
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

/** O bloqueio de verdade: o ACESSO à propriedade lança, como no navegador. */
function bloquearOAcesso(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

function sessaoDe(userId: string) {
  return {
    user: { id: userId, app_metadata: {} },
    access_token: `tok-${userId}`,
  };
}

const rpcMock = () => supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const fromMock = () => supabase.from as unknown as ReturnType<typeof vi.fn>;

describe("AuthContext — o painel abre com o armazenamento bloqueado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let desbloquear: (() => void) | null;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    desbloquear = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    desbloquear?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Boot sem sessão; devolve o callback do `onAuthStateChange`, a resposta
   * da RPC `is_admin` (controlada pelo teste) e a sonda. */
  async function montar(respostaDaRpc: () => Promise<unknown>) {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    let callback: AuthChangeCallback = () => {};
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: AuthChangeCallback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    rpcMock().mockImplementation((nome: string) => {
      if (nome === "is_admin") return respostaDaRpc();
      return Promise.resolve({ data: null, error: null });
    });
    fromMock().mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: null, error: { message: "401" } }),
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
    return { cb: () => callback, aoAtualizar };
  }

  async function entrar(
    ctx: { cb: () => AuthChangeCallback },
    userId: string,
  ): Promise<void> {
    await act(async () => {
      ctx.cb()("SIGNED_IN", sessaoDe(userId));
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("o servidor diz que é lojista: o painel abre, sem atalho gravado", async () => {
    const ctx = await montar(() =>
      Promise.resolve({ data: true, error: null }),
    );
    desbloquear = bloquearOAcesso();

    await entrar(ctx, "dona");

    const estado = ultimoEstado(ctx.aoAtualizar);
    expect(estado?.adminStatus).toBe("admin");
    expect(estado?.isAdmin).toBe(true);
    expect(estado?.adminVerificacaoFalhou).toBe(false);
  });

  it("o servidor diz que não é lojista: vira not-admin, sem erro", async () => {
    const ctx = await montar(() =>
      Promise.resolve({ data: false, error: null }),
    );
    desbloquear = bloquearOAcesso();

    await entrar(ctx, "cliente");

    const estado = ultimoEstado(ctx.aoAtualizar);
    expect(estado?.adminStatus).toBe("not-admin");
    expect(estado?.isAdmin).toBe(false);
    expect(estado?.adminVerificacaoFalhou).toBe(false);
  });

  it("o servidor não responde: oferece o Tentar de novo, nunca promove", async () => {
    const ctx = await montar(() => Promise.reject(new Error("sem rede")));
    desbloquear = bloquearOAcesso();

    await entrar(ctx, "dona");

    const estado = ultimoEstado(ctx.aoAtualizar);
    expect(estado?.adminStatus).toBe("unknown");
    expect(estado?.isAdmin).toBe(false);
    expect(estado?.adminVerificacaoFalhou).toBe(true);
  });

  it("controle: com o armazenamento normal o atalho continua sendo gravado", async () => {
    const ctx = await montar(() =>
      Promise.resolve({ data: true, error: null }),
    );

    await entrar(ctx, "dona");

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  it("controle: um 'true' no atalho NUNCA promove; só o servidor decide", async () => {
    vi.stubGlobal(
      "localStorage",
      criarLocalStorageFake({ ikcous_is_admin_intruso: "true" }),
    );
    const ctx = await montar(() =>
      Promise.resolve({ data: false, error: null }),
    );

    await entrar(ctx, "intruso");

    const estado = ultimoEstado(ctx.aoAtualizar);
    expect(estado?.adminStatus).toBe("not-admin");
    expect(estado?.isAdmin).toBe(false);
  });

  it("sair com o armazenamento bloqueado: a conta sai e a tela destrava", async () => {
    const ctx = await montar(() =>
      Promise.resolve({ data: true, error: null }),
    );
    await entrar(ctx, "dona");
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");

    desbloquear = bloquearOAcesso();
    // O ouvinte do login é `async`: uma exceção dele vira rejeição.
    const rejeicoes: unknown[] = [];
    await act(async () => {
      try {
        await ctx.cb()("SIGNED_OUT", null);
      } catch (erro) {
        rejeicoes.push(erro);
      }
      await esperarMicrotarefas();
    });

    const estado = ultimoEstado(ctx.aoAtualizar);
    expect(rejeicoes).toEqual([]);
    expect(estado?.userId).toBeNull();
    expect(estado?.adminStatus).toBe("not-admin");
    expect(estado?.loading).toBe(false);
  });

  it("o Sair com falha no servidor e armazenamento bloqueado: sai do mesmo jeito", async () => {
    const ctx = await montar(() =>
      Promise.resolve({ data: true, error: null }),
    );
    await entrar(ctx, "dona");
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "rede caída" } });

    desbloquear = bloquearOAcesso();
    const rejeicoes: unknown[] = [];
    await act(async () => {
      try {
        await ultimoEstado(ctx.aoAtualizar)?.logout();
      } catch (erro) {
        rejeicoes.push(erro);
      }
      await esperarMicrotarefas();
    });

    expect(rejeicoes).toEqual([]);
    const estado = ultimoEstado(ctx.aoAtualizar);
    expect(estado?.userId).toBeNull();
    expect(estado?.adminStatus).toBe("not-admin");
  });
});
