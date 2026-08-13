// @vitest-environment jsdom
//
// Issue #122 — dois defeitos da mesma família em AuthContext.tsx: (1) `logout`
// só limpa estado no caminho feliz do `supabase.auth.signOut()` — com a rede
// caída, `signOut` devolve erro e o `else` que limpa nunca roda, então o app
// fica "logado" e o token continua no `localStorage`; (2) o listener de
// `SIGNED_OUT` limpa `'app.favorites'` (chave morta, zero writers) e nunca
// toca `ikcous_orders_cache_${userId}` nem `ikcous_addresses_cache_${userId}`
// — dado pessoal (pedidos, CEP, rua, número, destinatário) sobrevive ao
// logout num dispositivo compartilhado.
//
// Mesmo padrão de tests/front/auth-admin-check.test.tsx: sem
// @testing-library/react (vitest.config.ts documenta a escolha), `createRoot`
// + `act` puro do React, e uma Sonda que REPORTA o contexto por callback (não
// por mutação de variável fechada — é isso que `react-hooks/globals` reprova).
// `vi.resetModules()` + `await import(...)` só para `@/contexts/AuthContext`,
// pelo mesmo motivo do outro arquivo: `checkInFlight`/`initPromise` são
// variáveis de módulo, compartilhadas entre instâncias de `AuthProvider` que
// reimportem o MESMO módulo.
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// auth-admin-check.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  hasSession: boolean;
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
    session: unknown;
    user: { id: string } | null;
    logout: () => Promise<void>;
  };
  aoAtualizar({
    hasSession: !!ctx.session,
    userId: ctx.user?.id ?? null,
    logout: ctx.logout,
  });
  return null;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  const chamadas = aoAtualizar.mock.calls;
  return chamadas.at(-1)?.[0];
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function montarProvider() {
  vi.resetModules();
  const { AuthContext, AuthProvider } = await import("@/contexts/AuthContext");
  return { AuthContext, AuthProvider };
}

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno de
// auth-admin-check.test.tsx.
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

function todasAsChaves(): string[] {
  const chaves: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) chaves.push(k);
  }
  return chaves;
}

function sessaoDe(userId: string) {
  return { user: { id: userId, app_metadata: {} }, access_token: `tok-${userId}` };
}

describe("AuthContext — limpeza local de sessão (issue #122)", () => {
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

  /** Monta o Provider sem sessão inicial, captura o callback do
   * `onAuthStateChange` para simular eventos manualmente, e loga o
   * user-a via SIGNED_IN — igual ao padrão de auth-admin-check.test.tsx. */
  async function montarLogado() {
    const { AuthContext, AuthProvider } = await montarProvider();
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (
      supabase.rpc as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: null, error: null });

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

    // Loga user-a — simula a sessão viva de quem vai clicar em "Sair".
    await act(async () => {
      callback("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    return { supabase, callback: () => callback, aoAtualizar };
  }

  it("1. signOut() devolvendo erro (rede caída) deixa o app deslogado, sem chave -auth-token nem -code-verifier", async () => {
    const { supabase, aoAtualizar } = await montarLogado();
    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-a");

    // Chaves de sessão do supabase-js, como as que ele persiste de verdade.
    localStorage.setItem(
      "sb-teste-auth-token",
      JSON.stringify({ access_token: "tok-user-a" }),
    );
    localStorage.setItem("sb-teste-code-verifier", "verificador-pkce");

    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const estado = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });

    const final = ultimoEstado(aoAtualizar)!;
    expect(final.hasSession).toBe(false);
    expect(final.userId).toBeNull();

    const restantes = todasAsChaves();
    expect(restantes.some((k) => k.includes("-auth-token"))).toBe(false);
    expect(restantes.some((k) => k.includes("-code-verifier"))).toBe(false);
  });

  it("2. após a limpeza, nenhuma chave com prefixo ikcous_orders_cache_ ou ikcous_addresses_cache_ permanece — inclusive de DOIS usuários diferentes", async () => {
    const { callback } = await montarLogado();

    localStorage.setItem("ikcous_orders_cache_user-a", "[]");
    localStorage.setItem("ikcous_orders_cache_user-b", "[]");
    localStorage.setItem("ikcous_addresses_cache_user-a", "[]");
    localStorage.setItem("ikcous_addresses_cache_user-b", "[]");
    // Chave morta (#122): não deve mais estar na lista do que se remove, mas
    // sua presença aqui não pode quebrar nada.
    localStorage.setItem("app.favorites", "[]");

    const cb = callback();
    await act(async () => {
      cb("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    const restantes = new Set(todasAsChaves());
    expect(restantes.has("ikcous_orders_cache_user-a")).toBe(false);
    expect(restantes.has("ikcous_orders_cache_user-b")).toBe(false);
    expect(restantes.has("ikcous_addresses_cache_user-a")).toBe(false);
    expect(restantes.has("ikcous_addresses_cache_user-b")).toBe(false);
  });

  it("3. marketplace_cart_v1 mantém o comportamento de hoje — apagado no SIGNED_OUT", async () => {
    const { callback } = await montarLogado();

    localStorage.setItem("marketplace_cart_v1", JSON.stringify([{ id: "x" }]));

    const cb = callback();
    await act(async () => {
      cb("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    expect(localStorage.getItem("marketplace_cart_v1")).toBeNull();
  });

  it("4. ikcous_last_shipping_cep e o prefixo ikcous_shipping_cache_ são removidos no SIGNED_OUT", async () => {
    const { callback } = await montarLogado();

    localStorage.setItem("ikcous_last_shipping_cep", "38500-000");
    localStorage.setItem(
      "ikcous_shipping_cache_38500000",
      JSON.stringify([{ id: "x" }]),
    );
    localStorage.setItem(
      "ikcous_shipping_cache_01310100",
      JSON.stringify([{ id: "y" }]),
    );

    const cb = callback();
    await act(async () => {
      cb("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    const restantes = todasAsChaves();
    expect(restantes.includes("ikcous_last_shipping_cep")).toBe(false);
    expect(restantes.some((k) => k.startsWith("ikcous_shipping_cache_"))).toBe(
      false,
    );
  });

  // Revisão de contexto limpo do diff (achado 1) — o ramo de ERRO de `logout`
  // (rede caída em `signOut`) mexia em quatro `setState` e no `localStorage`,
  // mas deixava `activeUserIdRef.current` apontando para o usuário que saiu.
  // Cenário: `checkAdmin` dispara a RPC `is_admin` (até 3s em voo); dentro
  // dessa janela o usuário clica "Encerrar Sessão" e `signOut` falha (5xx/429)
  // enquanto a RPC ainda está pendurada. Sem zerar o ref, a resposta tardia da
  // RPC vê `activeUserIdRef.current === userId` (ainda igual) e GRAVA
  // `ikcous_is_admin_<uuid>` no localStorage do usuário que já saiu.
  it("5. signOut() falhando com uma checagem de admin em voo não deixa ikcous_is_admin_<uuid> gravado para o usuário que saiu", async () => {
    const { AuthContext, AuthProvider } = await montarProvider();
    const { supabase } = await import("@/lib/supabase");

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

    // A RPC is_admin fica pendurada até o teste resolvê-la manualmente —
    // reproduz a janela de até 3s em que `checkAdmin` está em voo.
    let resolverIsAdmin: (v: unknown) => void = () => {};
    (
      supabase.rpc as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((name: string) => {
      if (name === "is_admin") {
        return new Promise((resolve) => {
          resolverIsAdmin = resolve;
        });
      }
      return Promise.resolve({ data: null, error: null });
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

    // user-a entra — dispara `checkAdmin`, cuja RPC fica em voo (ver acima).
    await act(async () => {
      callback("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    // Usuário toca "Encerrar Sessão" dentro da janela de 3s; a rede falha.
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const estado = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });

    // A RPC atrasada finalmente responde, dizendo que user-a É admin.
    await act(async () => {
      resolverIsAdmin({ data: true, error: null });
      await esperarMicrotarefas();
    });

    expect(localStorage.getItem("ikcous_is_admin_user-a")).not.toBe("true");
  });
});
