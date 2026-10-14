// @vitest-environment jsdom
//
// Rede lenta não rebaixa a dona que o servidor já confirmou.
//
// Defeito medido numa caçada (14/10/2026), no celular com internet lenta: a
// lojista sai do app (câmera, WhatsApp) e volta. A biblioteca de login
// reanuncia SIGNED_IN ao voltar e, a cada hora, TOKEN_REFRESHED. O
// AuthContext recheca em segundo plano se ela é dona (RPC `is_admin`, limite
// de 3 s). Ao estourar o limite, `applyResult(false, false)` gravava "não é
// dona" POR CIMA do "é dona" já confirmado, `App.tsx` trocava o painel por
// "Acesso restrito a administradores." e mandava à página inicial: o cadastro
// aberto fechava, a foto subindo se perdia, e entrar de novo expulsava outra
// vez.
//
// Regra que estes testes prendem: numa recheca de FUNDO (a dona já foi
// confirmada pelo servidor NESTA sessão), estouro de tempo ou erro de
// rede/HTTP não rebaixa; só um "não" REAL do servidor (resposta bem-sucedida
// dizendo false) rebaixa, na hora. O primeiro login sem estado prévio continua
// como antes (estouro → não é dona), logout e troca de conta esquecem a
// confirmação, e erro nunca grava nada no aparelho.
//
// O banco continua protegendo as gravações por `is_admin()`; isto é só o que a
// tela mostra. Harness copiado de auth-admin-check.test.tsx (mesmos motivos
// para `resetModules` e para o `localStorage` falso — ver o cabeçalho dele).
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
    user: { id: string } | null;
  };
  aoAtualizar({
    isAdmin: ctx.isAdmin,
    adminStatus: ctx.adminStatus,
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

const rpcMock = () => supabase.rpc as unknown as ReturnType<typeof vi.fn>;
const fromMock = () => supabase.from as unknown as ReturnType<typeof vi.fn>;

describe("AuthContext — recheca de fundo não rebaixa a dona confirmada", () => {
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
    vi.useRealTimers();
  });

  /** `from("profiles")...single()` (o plano B da checagem) responde o que o
   * teste mandar; por padrão, falha rápido como um 401. */
  function profilesResponde(resultado: { data: unknown; error: unknown }) {
    fromMock().mockImplementation(() => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve(resultado) }),
      }),
    }));
  }

  /** Boot sem sessão; devolve o callback do `onAuthStateChange`, a fila de
   * chamadas `is_admin` (cada uma controlada pelo teste) e a sonda. */
  async function montar() {
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
    const fila: Pendente[] = [];
    rpcMock().mockImplementation((nome: string) => {
      if (nome === "is_admin") {
        return new Promise((resolve, reject) => {
          fila.push({ resolve, reject });
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    profilesResponde({ data: null, error: { message: "401" } });
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

  /** Primeiro login da dona: o servidor responde `true` e o painel abre. Os
   * timers ainda são reais aqui; o teste liga os falsos depois. */
  async function entrarComoDona(userId = "dona") {
    const ctx = await montar();
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
    userId = "dona",
  ) {
    await act(async () => {
      ctx.cb()(evento, sessaoDe(userId));
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // ---------------------------------------------------------------------
  // A prova do caçador
  // ---------------------------------------------------------------------

  it.each(["SIGNED_IN", "TOKEN_REFRESHED"])(
    "1. %s de fundo com a rede engasgada (3,1 s sem resposta) mantém a dona; o 'sim' atrasado continua valendo",
    async (evento) => {
      const ctx = await entrarComoDona();
      vi.useFakeTimers();

      await disparar(ctx, evento);
      expect(ctx.fila.length).toBe(2); // a recheca saiu para a rede

      await avancar(2900);
      expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");

      await avancar(200); // 3,1 s: o limite estourou
      expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
      expect(ultimoEstado(ctx.aoAtualizar)?.isAdmin).toBe(true);

      // A resposta "sim" chega atrasada: segue dona, cache intacto.
      ctx.fila[1].resolve({ data: true, error: null });
      await avancar(0);
      expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
      expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
    },
  );

  it("2. controle: a recheca que responde em 1 s mantém a dona (nada mudou para quem tem rede boa)", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    await disparar(ctx, "SIGNED_IN");
    await avancar(1000);
    ctx.fila[1].resolve({ data: true, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  it("3. a recheca que LANÇA exceção de rede (fetch failed) mantém a dona", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    await disparar(ctx, "TOKEN_REFRESHED");
    ctx.fila[1].reject(new Error("fetch failed"));
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  it("4. a RPC E o plano B em profiles falham rápido (401): a dona continua dona e o aparelho NÃO grava 'false'", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    await disparar(ctx, "SIGNED_IN");
    ctx.fila[1].resolve({
      data: null,
      error: { message: "JWT expired", status: 401 },
    });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    // Erro não é veredito: nada de "false" para a próxima abertura ler.
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("true");
  });

  // ---------------------------------------------------------------------
  // O "não" real rebaixa, na hora
  // ---------------------------------------------------------------------

  it("5. resposta REAL false do servidor numa recheca rebaixa na hora e grava 'false'", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    await disparar(ctx, "TOKEN_REFRESHED");
    ctx.fila[1].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(ultimoEstado(ctx.aoAtualizar)?.isAdmin).toBe(false);
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("false");
  });

  it("6. plano B em profiles que RESPONDE com outro papel é um 'não' real e rebaixa", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();
    profilesResponde({ data: { role: "customer" }, error: null });

    await disparar(ctx, "SIGNED_IN");
    ctx.fila[1].resolve({ data: null, error: { message: "rpc fora do ar" } });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("false");
  });

  it("7. depois de uma recheca engasgada, o 'não' real da recheca seguinte ainda rebaixa", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    await disparar(ctx, "SIGNED_IN");
    await avancar(3100); // engasgou: segue dona
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");

    await disparar(ctx, "TOKEN_REFRESHED");
    ctx.fila[2].resolve({ data: false, error: null });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(localStorage.getItem("ikcous_is_admin_dona")).toBe("false");
  });

  // ---------------------------------------------------------------------
  // O que NÃO mudou: sem confirmação prévia, nada de benefício da dúvida
  // ---------------------------------------------------------------------

  it("8. primeiro login com estouro de tempo: não é dona, e nada é gravado no aparelho", async () => {
    const ctx = await montar();
    vi.useFakeTimers();

    await disparar(ctx, "SIGNED_IN", "primeira-vez");
    await avancar(3100);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(localStorage.getItem("ikcous_is_admin_primeira-vez")).toBeNull();

    // O "sim" atrasado do primeiro login continua descartado (como antes).
    ctx.fila[0].resolve({ data: true, error: null });
    await avancar(0);
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
  });

  it("9. primeiro login com RPC e plano B falhando rápido: não é dona e o aparelho NÃO grava 'false'", async () => {
    const ctx = await montar();
    vi.useFakeTimers();

    await disparar(ctx, "SIGNED_IN", "primeira-vez");
    ctx.fila[0].resolve({ data: null, error: { message: "401", status: 401 } });
    await avancar(0);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(localStorage.getItem("ikcous_is_admin_primeira-vez")).toBeNull();
  });

  it("10. sair e entrar de novo é primeiro login: o estouro NÃO herda a confirmação anterior", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();

    await act(async () => {
      ctx.cb()("SIGNED_OUT", null);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");

    await disparar(ctx, "SIGNED_IN");
    await avancar(3100);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(ultimoEstado(ctx.aoAtualizar)?.isAdmin).toBe(false);
  });

  it("11. troca de conta: a outra pessoa que estoura o tempo NÃO herda o 'é dona' da anterior", async () => {
    const ctx = await entrarComoDona("dona");
    vi.useFakeTimers();

    await disparar(ctx, "SIGNED_IN", "cliente");
    await avancar(3100);

    expect(ultimoEstado(ctx.aoAtualizar)?.userId).toBe("cliente");
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
    expect(localStorage.getItem("ikcous_is_admin_cliente")).toBeNull();
  });

  it("12. troca de conta e volta (dona → cliente → dona): o estouro da volta não herda a confirmação antiga", async () => {
    const ctx = await entrarComoDona("dona");
    vi.useFakeTimers();

    await disparar(ctx, "SIGNED_IN", "cliente");
    await disparar(ctx, "SIGNED_IN", "dona");
    await avancar(3100);

    expect(ultimoEstado(ctx.aoAtualizar)?.userId).toBe("dona");
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("not-admin");
  });

  it("13. 'false' que outra aba gravou no aparelho não rebaixa a dona confirmada numa recheca engasgada", async () => {
    const ctx = await entrarComoDona();
    vi.useFakeTimers();
    localStorage.setItem("ikcous_is_admin_dona", "false");

    await disparar(ctx, "SIGNED_IN");
    // O atalho do cache NÃO pode ter rebaixado antes de a rede falar.
    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
    await avancar(3100);

    expect(ultimoEstado(ctx.aoAtualizar)?.adminStatus).toBe("admin");
  });
});
