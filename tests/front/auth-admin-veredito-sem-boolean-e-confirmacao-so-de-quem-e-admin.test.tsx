// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), papéis: dois limites de
// `checkAdmin` (AuthContext) que os testes vizinhos (`auth-admin-check`,
// `auth-admin-recheca-de-fundo-nao-rebaixa-a-dona`) não separam.
//
//  1. A pergunta `is_admin` respondeu SEM erro mas sem um sim/não de verdade
//     (`data` nulo): isso não é veredito. O caminho é o fallback em `profiles`
//     (quem decide é o cargo gravado lá). Tratar "sem erro" como veredito
//     devolveria `null` como "não é admin" e gravaria "false" no aparelho para
//     uma lojista legítima — e, no sentido contrário, nunca consultaria o cargo.
//  2. `contaAindaTemAcessoAdmin(id)` (usado pela exportação de pedidos para
//     saber se a conta AINDA é administradora) só vale `true` para quem o
//     servidor CONFIRMOU como administrador nesta sessão. Quem recebeu um "não"
//     real continua `false`: se a confirmação fosse gravada também no "não", uma
//     conta rebaixada passaria na checagem de permissão da exportação.
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
  readonly isAdmin: boolean;
  readonly adminStatus: AdminStatus;
  readonly contaAindaTemAcessoAdmin: (id: string) => boolean;
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
  const ctx = useContext(authContext) as Snapshot;
  aoAtualizar({
    isAdmin: ctx.isAdmin,
    adminStatus: ctx.adminStatus,
    contaAindaTemAcessoAdmin: ctx.contaAindaTemAcessoAdmin,
  });
  return null;
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** localStorage em memória (o do Node 25 pisa no do jsdom; ver o vizinho). */
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

type Resposta = { data: unknown; error: unknown };

describe("AuthContext — veredito sem boolean e confirmação só de quem é admin", () => {
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
    window.history.replaceState(null, "", "/");
  });

  /** Entra como `userId`: `is_admin` responde `respostaIsAdmin`; o fallback em
   * `profiles` devolve `cargoNoBanco` (ou erro, se `undefined`). */
  async function entrarComo(
    userId: string,
    respostaIsAdmin: Resposta,
    cargoNoBanco?: string,
  ) {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const dublê = supabase as any;
    dublê.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    dublê.auth.signOut.mockResolvedValue({ error: null });
    let callback: AuthChangeCallback = () => {};
    dublê.auth.onAuthStateChange.mockImplementation(
      (cb: AuthChangeCallback) => {
        callback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    );
    dublê.rpc.mockImplementation((nome: string) =>
      Promise.resolve(
        nome === "is_admin" ? respostaIsAdmin : { data: null, error: null },
      ),
    );
    dublê.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve(
              cargoNoBanco === undefined
                ? { data: null, error: { message: "sem resposta" } }
                : { data: { role: cargoNoBanco }, error: null },
            ),
        }),
      }),
    }));

    const aoAtualizar = vi.fn<(s: Snapshot) => void>();
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
      callback("SIGNED_IN", sessaoDe(userId));
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    const ultimo = aoAtualizar.mock.calls.at(-1)?.[0];
    if (!ultimo) throw new Error("a sonda não renderizou");
    return ultimo;
  }

  it("is_admin sem erro e sem boolean + cargo 'admin' no banco: é administradora", async () => {
    const estado = await entrarComo(
      "user-a",
      { data: null, error: null },
      "admin",
    );
    expect(estado.adminStatus).toBe("admin");
    expect(estado.isAdmin).toBe(true);
    expect(estado.contaAindaTemAcessoAdmin("user-a")).toBe(true);
  });

  it("is_admin sem erro e sem boolean + cargo 'customer' no banco: não é administradora", async () => {
    const estado = await entrarComo(
      "user-a",
      { data: null, error: null },
      "customer",
    );
    expect(estado.adminStatus).toBe("not-admin");
    expect(estado.isAdmin).toBe(false);
  });

  it("is_admin devolvendo texto em vez de boolean também cai no cargo do banco (texto 'true' não vale como sim)", async () => {
    const estado = await entrarComo(
      "user-a",
      { data: "true", error: null },
      "customer",
    );
    expect(estado.isAdmin).toBe(false);
    expect(estado.adminStatus).toBe("not-admin");
  });

  it("'não' real do servidor: contaAindaTemAcessoAdmin segue falso para a própria conta", async () => {
    const estado = await entrarComo("user-a", { data: false, error: null });
    expect(estado.adminStatus).toBe("not-admin");
    expect(estado.contaAindaTemAcessoAdmin("user-a")).toBe(false);
  });

  it("'sim' real do servidor: contaAindaTemAcessoAdmin vale só para ESSA conta", async () => {
    const estado = await entrarComo("user-a", { data: true, error: null });
    expect(estado.adminStatus).toBe("admin");
    expect(estado.contaAindaTemAcessoAdmin("user-a")).toBe(true);
    expect(estado.contaAindaTemAcessoAdmin("user-b")).toBe(false);
  });
});

interface Pendente {
  readonly resolve: (v: Resposta) => void;
  readonly reject: (e: unknown) => void;
}

describe("AuthContext — troca de conta com a pergunta do servidor ainda em voo", () => {
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
    window.history.replaceState(null, "", "/");
  });

  /** Provider sem sessão no boot; cada `is_admin` fica pendente numa fila que
   * o teste resolve na ordem que quiser. */
  async function montar() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const dublê = supabase as any;
    dublê.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    dublê.auth.signOut.mockResolvedValue({ error: null });
    let callback: AuthChangeCallback = () => {};
    dublê.auth.onAuthStateChange.mockImplementation(
      (cb: AuthChangeCallback) => {
        callback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    );
    const fila: Pendente[] = [];
    dublê.rpc.mockImplementation((nome: string) => {
      if (nome !== "is_admin")
        return Promise.resolve({ data: null, error: null });
      return new Promise<Resposta>((resolve, reject) => {
        fila.push({ resolve, reject });
      });
    });
    const aoAtualizar = vi.fn<(s: Snapshot) => void>();
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
    const entrar = async (userId: string) => {
      await act(async () => {
        callback("SIGNED_IN", sessaoDe(userId));
        await esperarMicrotarefas();
      });
    };
    const sair = async () => {
      await act(async () => {
        callback("SIGNED_OUT", null);
        await esperarMicrotarefas();
      });
    };
    const responder = async (i: number, resposta: Resposta) => {
      await act(async () => {
        fila.at(i)?.resolve(resposta);
        await esperarMicrotarefas();
      });
    };
    const falhar = async (i: number) => {
      await act(async () => {
        fila.at(i)?.reject(new Error("rede caiu"));
        await esperarMicrotarefas();
      });
    };
    const estado = (): Snapshot => {
      const ultimo = aoAtualizar.mock.calls.at(-1)?.[0];
      if (!ultimo) throw new Error("a sonda não renderizou");
      return ultimo;
    };
    return { entrar, sair, responder, falhar, estado };
  }

  it("A confirmada e B ainda sem resposta: nenhuma das duas passa em contaAindaTemAcessoAdmin", async () => {
    const { entrar, responder, estado } = await montar();
    await entrar("user-a");
    await responder(0, { data: true, error: null });
    expect(estado().contaAindaTemAcessoAdmin("user-a")).toBe(true);

    await entrar("user-b");
    // B é a conta ativa, mas o servidor ainda não disse nada sobre ela: "não sei"
    // nunca vale como "tem acesso". E A já não é a conta em uso.
    expect(estado().contaAindaTemAcessoAdmin("user-b")).toBe(false);
    expect(estado().contaAindaTemAcessoAdmin("user-a")).toBe(false);

    await responder(1, { data: false, error: null });
    expect(estado().contaAindaTemAcessoAdmin("user-b")).toBe(false);
    expect(estado().contaAindaTemAcessoAdmin("user-a")).toBe(false);
  });

  it("falha tardia da pergunta de A (rede) não derruba B, que já foi confirmada administradora", async () => {
    const { entrar, responder, falhar, estado } = await montar();
    await entrar("user-a");
    await entrar("user-b");
    await responder(1, { data: true, error: null });
    expect(estado().adminStatus).toBe("admin");

    await falhar(0);

    expect(estado().adminStatus).toBe("admin");
    expect(estado().isAdmin).toBe(true);
    expect(estado().contaAindaTemAcessoAdmin("user-b")).toBe(true);
  });

  it("sair da conta: administradora confirmada deixa de ser administradora", async () => {
    const { entrar, sair, responder, estado } = await montar();
    await entrar("user-a");
    await responder(0, { data: true, error: null });
    expect(estado().isAdmin).toBe(true);

    await sair();

    expect(estado().isAdmin).toBe(false);
    expect(estado().adminStatus).toBe("not-admin");
    expect(estado().contaAindaTemAcessoAdmin("user-a")).toBe(false);
  });
});
