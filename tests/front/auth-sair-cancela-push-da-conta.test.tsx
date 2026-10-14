// @vitest-environment jsdom
//
// A inscrição de notificação push ficava no APARELHO, no nome de quem estava
// logado, e o "Sair" nunca a tocava: o push dirigido a quem saiu (o aviso do
// pedido dele, o que o lojista mandar; no aparelho do lojista, o aviso de
// pedido novo) continuava caindo no celular, agora na mão de quem entrasse
// depois.
//
// Aqui se trava a parte do AuthContext: o "Sair" cancela a inscrição da conta
// que sai ENQUANTO a sessão ainda existe (a RLS só deixa a dona apagar a
// própria linha), com prazo curto, e a falha ou a lentidão disso nunca impede
// o Sair; e, quando o fim da sessão vem de fora (outra aba, sessão vencida) ou
// a conta muda direto de A para B, o navegador é desinscrito mesmo sem a
// sessão de A.
//
// Mesmo andaime de auth-logout-cleanup.test.tsx (sem @testing-library/react).
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const apagarLinha = vi.fn();
const ordem: string[] = [];

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
    from: vi.fn((tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          delete: () => ({
            eq: () => ({ eq: () => apagarLinha() }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: { message: "não usado nestes testes" },
              }),
          }),
        }),
      };
    }),
  },
}));

// Passa para o módulo REAL por padrão (o teste do prazo usa o relógio e o
// service worker de verdade) e deixa cada teste trocar a implementação.
vi.mock("@/lib/inscricao-de-push-da-conta", async (original) => {
  const real =
    await original<typeof import("@/lib/inscricao-de-push-da-conta")>();
  return {
    ...real,
    cancelarInscricaoDaConta: vi.fn(real.cancelarInscricaoDaConta),
    soltarInscricaoDoAparelho: vi.fn(real.soltarInscricaoDoAparelho),
  };
});

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
  aoAtualizar({ userId: ctx.user?.id ?? null, logout: ctx.logout });
  return null;
}

function ultimoEstado(aoAtualizar: ReturnType<typeof vi.fn>): Snapshot {
  return aoAtualizar.mock.calls.at(-1)?.[0] as Snapshot;
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

describe("AuthContext — o Sair cancela a inscrição de push da conta que sai", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    ordem.length = 0;
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  async function montarLogado() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");
    const push = await import("@/lib/inscricao-de-push-da-conta");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(async () => {
      ordem.push("signOut");
      return { error: null };
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

    return {
      supabase,
      push: push as unknown as {
        cancelarInscricaoDaConta: ReturnType<typeof vi.fn>;
        soltarInscricaoDoAparelho: ReturnType<typeof vi.fn>;
      },
      callback: () => callback,
      aoAtualizar,
    };
  }

  it("1. o Sair cancela a inscrição da conta que sai ANTES de encerrar a sessão", async () => {
    const { push, aoAtualizar } = await montarLogado();
    expect(ultimoEstado(aoAtualizar).userId).toBe("user-a");
    push.cancelarInscricaoDaConta.mockImplementation(async () => {
      ordem.push("cancelarPush");
    });

    await act(async () => {
      await ultimoEstado(aoAtualizar).logout();
    });

    expect(push.cancelarInscricaoDaConta).toHaveBeenCalledWith("user-a");
    expect(ordem).toEqual(["cancelarPush", "signOut"]);
  });

  it("2. o cancelamento do push falhar (lançar) não impede o Sair", async () => {
    const { push, supabase, aoAtualizar } = await montarLogado();
    push.cancelarInscricaoDaConta.mockRejectedValue(new Error("explodiu"));

    await act(async () => {
      await ultimoEstado(aoAtualizar).logout();
    });

    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(ultimoEstado(aoAtualizar).userId).toBeNull();
  });

  it("3. servidor pendurado: o signOut acontece dentro do prazo e o navegador já foi desinscrito", async () => {
    const { supabase, aoAtualizar } = await montarLogado();
    const { PRAZO_DO_PUSH_NO_LOGOUT_MS } = await import(
      "@/lib/inscricao-de-push-da-conta"
    );
    const unsubscribe = vi.fn(async () => true);
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({
              endpoint: "https://push.exemplo/a",
              unsubscribe,
            }),
          },
        }),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "PushManager", {
      value: class {},
      configurable: true,
      writable: true,
    });
    apagarLinha.mockImplementation(() => new Promise(() => {})); // nunca responde

    const estado = ultimoEstado(aoAtualizar);
    vi.useFakeTimers();
    let saiu = false;
    await act(async () => {
      const saida = estado.logout().then(() => {
        saiu = true;
      });
      await vi.advanceTimersByTimeAsync(PRAZO_DO_PUSH_NO_LOGOUT_MS - 1);
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
      expect(saiu).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await saida;
    });

    expect(apagarLinha).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    expect(saiu).toBe(true);
  });

  it("4. quem nunca entrou na conta e 'sai': nada de push é tocado", async () => {
    const { push, callback, aoAtualizar } = await montarLogado();
    // A sessão acabou (outra aba): já não há quem sair.
    await act(async () => {
      callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });
    push.cancelarInscricaoDaConta.mockClear();

    await act(async () => {
      await ultimoEstado(aoAtualizar).logout();
    });

    expect(push.cancelarInscricaoDaConta).not.toHaveBeenCalled();
  });

  it("5. o fim da sessão vindo de fora (SIGNED_OUT: outra aba, sessão vencida) desinscreve o navegador, sem servidor", async () => {
    const { push, callback } = await montarLogado();
    push.soltarInscricaoDoAparelho.mockClear();

    await act(async () => {
      callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    expect(push.soltarInscricaoDoAparelho).toHaveBeenCalledTimes(1);
    expect(apagarLinha).not.toHaveBeenCalled();
  });

  it("6. troca direta de conta (A -> B, sem SIGNED_OUT) desinscreve o navegador de A", async () => {
    const { push, callback } = await montarLogado();
    push.soltarInscricaoDoAparelho.mockClear();

    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    expect(push.soltarInscricaoDoAparelho).toHaveBeenCalledTimes(1);
  });

  it("7. o SIGNED_IN que o navegador reemite ao voltar à aba (mesma conta) NÃO desinscreve ninguém", async () => {
    const { push, callback } = await montarLogado();
    push.soltarInscricaoDoAparelho.mockClear();

    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });
    await act(async () => {
      callback()("TOKEN_REFRESHED", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    expect(push.soltarInscricaoDoAparelho).not.toHaveBeenCalled();
    expect(push.cancelarInscricaoDaConta).not.toHaveBeenCalled();
  });
});
