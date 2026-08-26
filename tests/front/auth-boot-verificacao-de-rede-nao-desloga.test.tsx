// @vitest-environment jsdom
//
// CONTA-02 (auditoria de 26/08/2026) — na verificação de sessão do boot
// (AuthContext.tsx, dentro de `initAuth`), só três sinais eram classificados
// como "sessão realmente inválida": `verifyError.status === 403`, a mensagem
// conter "not found", ou conter "Invalid token". Qualquer OUTRA falha de
// `supabase.auth.getUser()` — 500, 502, timeout de proxy, rede caída —
// terminava no mesmo lugar: `verifiedUser` vem `null` sempre que há erro
// (confirmado na fonte, node_modules/@supabase/auth-js/dist/module/
// GoTrueClient.js:2660-2676 — `_getUser` NUNCA lança para erro de rede/5xx,
// devolve `{data:{user:null}, error}`), e o `else` de
// `if (verifiedUser) {...} else { signOut() }` deslogava a pessoa mesmo sem
// nenhuma prova de que a sessão estava morta. O `signOut()` bem-sucedido
// dispara `SIGNED_OUT`, que limpa carrinho, vistos recentemente, comparados
// e CEP de frete — tudo por causa de um engasgo de rede de um segundo.
//
// A correção usa `AuthRetryableFetchError`/`isAuthRetryableFetchError`, que
// o próprio @supabase/auth-js lança para qualquer falha de rede ou status
// 5xx (node_modules/@supabase/auth-js/dist/module/lib/fetch.js:18-32) — uma
// classificação ESTRUTURAL (classe do erro), não uma lista de strings nova.
//
// Mesmo padrão de tests/front/auth-admin-check.test.tsx: sem
// @testing-library/react (vitest.config.ts documenta a escolha), createRoot +
// act puro do React, sonda que reporta por callback, e vi.resetModules() só
// para @/contexts/AuthContext (checkInFlight/initPromise são variáveis de
// módulo compartilhadas entre instâncias de AuthProvider que reimportem o
// MESMO módulo).
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// auth-admin-check.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Snapshot {
  hasSession: boolean;
  userId: string | null;
}

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
  };
  aoAtualizar({
    hasSession: !!ctx.session,
    userId: ctx.user?.id ?? null,
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

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno de
// auth-admin-check.test.tsx e auth-logout-cleanup.test.tsx.
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

// Achado de auditoria de 26/08/2026: o teste 1 original mockava
// `onAuthStateChange` com um `mockReturnValue` fixo, desconectado de
// `signOut`. Isso deixava `hasSession`, `userId` e o carrinho SEM PODER
// DISCRIMINAR a regressão que o título promete cobrir — se a correção fosse
// removida, o `else` de `initAuth` chama `signOut()`, mas SEM esta ponte o
// mock de `signOut` "acontecia" sem efeito nenhum sobre sessão, usuário ou
// `localStorage`, e as três asserções passavam do mesmo jeito. Só
// `expect(signOut).not.toHaveBeenCalled()` era portante.
//
// Esta função conecta o mock de `signOut` ao callback registrado em
// `onAuthStateChange`, reproduzindo o que o GoTrue real faz ao deslogar com
// sucesso: dispara `SIGNED_OUT` no listener. É ESSE evento
// (AuthContext.tsx, dentro de `onAuthStateChange`) que zera sessão/usuário
// e chama `clearLocalUserData()` — a mesma função que limpa o carrinho.
function conectarSignOutRealista(supabase: any) {
  let callback: ((event: string, session: unknown) => unknown) | undefined;
  (
    supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>
  ).mockImplementation((cb: typeof callback) => {
    callback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  (supabase.auth.signOut as ReturnType<typeof vi.fn>).mockImplementation(
    async () => {
      await callback?.("SIGNED_OUT", null);
      return { error: null };
    },
  );
}

async function montarProvider() {
  vi.resetModules();
  const { AuthContext, AuthProvider } = await import("@/contexts/AuthContext");
  const { supabase } = await import("@/lib/supabase");
  return { AuthContext, AuthProvider, supabase };
}

describe("AuthContext — verificação de sessão do boot não desloga em falha de rede (CONTA-02)", () => {
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

  it("1. getUser() falhando com AuthRetryableFetchError (502) mantém sessão, usuário e carrinho — não chama signOut", async () => {
    const { AuthContext, AuthProvider, supabase } = await montarProvider();

    const sessao = sessaoDe("user-cliente");
    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: sessao }, error: null });
    // Reproduz exatamente o que o SDK devolve para 5xx/rede: NUNCA lança,
    // sempre resolve com user:null e o erro pareado (ver cabeçalho).
    (
      supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("Service Unavailable", 502),
    });
    conectarSignOutRealista(supabase);
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    // Carrinho montado ANTES do boot — é exatamente o que o defeito apaga.
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([{ id: "produto-x" }]),
    );

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
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    const final = ultimoEstado(aoAtualizar)!;
    expect(final.hasSession).toBe(true);
    expect(final.userId).toBe("user-cliente");
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem("marketplace_cart_v1")).not.toBeNull();
  });

  it("2. getUser() falhando com status 403 (sessão comprovadamente inválida) continua deslogando — o caminho de segurança não pode afrouxar", async () => {
    const { AuthContext, AuthProvider, supabase } = await montarProvider();

    const sessao = sessaoDe("user-banido");
    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: sessao }, error: null });
    (
      supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: null },
      error: { status: 403, message: "Forbidden" },
    });
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: null });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
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
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(ultimoEstado(aoAtualizar)?.hasSession).toBe(false);
    expect(ultimoEstado(aoAtualizar)?.userId).toBeNull();
  });

  // CONTA-02b (BLOQUEIA parcial, auditoria de 26/08/2026) — 429 (rate limit)
  // não é 403/"not found"/"Invalid token" (não é `isDefinitivelyInvalid`) e
  // não está em `NETWORK_ERROR_CODES` (500-504, 520-530 — só aí o SDK lança
  // `AuthRetryableFetchError`); para 429 o SDK lança `AuthApiError(message,
  // 429)` (node_modules/@supabase/auth-js/dist/module/lib/fetch.js:26-32 e
  // 74). Sem tratar esse caso, o mesmo `else` do teste 2 deslogava por causa
  // de um limite de taxa — que várias abas ou recargas rápidas contra
  // `GET /user` disparam sem a sessão estar morta.
  it("3. getUser() falhando com AuthApiError 429 (rate limit) mantém sessão, usuário e carrinho — não chama signOut", async () => {
    const { AuthContext, AuthProvider, supabase } = await montarProvider();

    const sessao = sessaoDe("user-cliente-limitado");
    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: sessao }, error: null });
    (
      supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      data: { user: null },
      error: new AuthApiError(
        "Too Many Requests",
        429,
        "over_request_rate_limit",
      ),
    });
    conectarSignOutRealista(supabase);
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([{ id: "produto-x" }]),
    );

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
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    const final = ultimoEstado(aoAtualizar)!;
    expect(final.hasSession).toBe(true);
    expect(final.userId).toBe("user-cliente-limitado");
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem("marketplace_cart_v1")).not.toBeNull();
  });
});
