// @vitest-environment jsdom
//
// admin_cache-17 — cachedCustomersData/cachedCouponsData/cachedReviewsData/
// cachedQuestionsData (src/utils/admin_cache.ts) são `let` de MÓDULO, sem
// chave de usuário: sobreviviam ao logout (clearLocalUserData só varria
// localStorage) e à troca de conta na mesma aba/PWA. Num tablet de balcão
// compartilhado, o lojista B via nome/telefone/LTV que o lojista A carregou,
// pintados no primeiro frame da tela de clientes.
//
// Mesmo padrão de tests/front/auth-logout-cleanup.test.tsx (modelo citado na
// tarefa): sem @testing-library/react, `createRoot` + `act` puro do React, e
// uma Sonda que reporta o contexto por callback. `vi.resetModules()` +
// `await import(...)` para `@/contexts/AuthContext` E `@/utils/admin_cache`
// dentro do MESMO ciclo de reset — as variáveis de módulo de admin_cache.ts
// só ficam isoladas entre testes se os dois módulos vierem da mesma
// reimportação (o AuthContext importa `@/utils/admin_cache` internamente;
// importar de novo aqui pega a mesma instância, não uma cópia).
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
// auth-logout-cleanup.test.tsx.
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
  aoAtualizar({
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

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno de
// auth-logout-cleanup.test.tsx.
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

/** Popula os quatro caches de admin com dado "do lojista A" — o mesmo shape
 * que os hooks de fetch reais gravam (ver admin_cache.ts). */
function popularCachesDeAdmin(
  adminCache: typeof import("@/utils/admin_cache"),
) {
  adminCache.setCachedCustomersData({
    customers: [
      {
        id: "cliente-1",
        email: "cliente@exemplo.com",
        full_name: "Cliente do Lojista A",
        phone: "38999990000",
        role: "customer",
        created_at: new Date().toISOString(),
      },
    ],
    total: 1,
    stats: {
      total_customers: 1,
      global_ltv: 500,
      global_orders: 3,
      new_customers_30d: 1,
    },
  });
  adminCache.setCachedCouponsData([{ id: "cupom-1", code: "PROMO10" }] as any);
  adminCache.setCachedReviewsData([
    { id: "review-1", comment: "ótimo" },
  ] as any);
  adminCache.setCachedQuestionsData([
    { id: "pergunta-1", question: "?" },
  ] as any);
}

describe("admin_cache — limpo no logout e na troca de usuário (admin_cache-17)", () => {
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
   * `onAuthStateChange`, loga "user-a" e devolve a MESMA instância do módulo
   * `admin_cache` que o AuthContext importou (ver comentário do topo). */
  async function montarLogado() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const adminCache = await import("@/utils/admin_cache");
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
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

    // Loga user-a — simula o lojista A já dentro do painel admin.
    await act(async () => {
      callback("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    return { adminCache, callback: () => callback, aoAtualizar };
  }

  it("1. SIGNED_OUT zera os quatro caches de admin", async () => {
    const { adminCache, callback, aoAtualizar } = await montarLogado();
    expect(ultimoEstado(aoAtualizar)?.userId).toBe("user-a");

    popularCachesDeAdmin(adminCache);
    expect(adminCache.cachedCustomersData).not.toBeNull();
    expect(adminCache.cachedCouponsData).not.toBeNull();
    expect(adminCache.cachedReviewsData).not.toBeNull();
    expect(adminCache.cachedQuestionsData).not.toBeNull();

    const cb = callback();
    await act(async () => {
      cb("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    // Se `limparCachesDeAdmin()` sumir de `clearLocalUserData()`, estas
    // quatro variáveis continuam com o dado do lojista A e a asserção falha.
    expect(adminCache.cachedCustomersData).toBeNull();
    expect(adminCache.cachedCouponsData).toBeNull();
    expect(adminCache.cachedReviewsData).toBeNull();
    expect(adminCache.cachedQuestionsData).toBeNull();
  });

  it("2. logout() com signOut() falhando (rede caída) também zera os caches de admin", async () => {
    const { adminCache, aoAtualizar } = await montarLogado();
    const { supabase } = await import("@/lib/supabase");

    popularCachesDeAdmin(adminCache);

    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const estado = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });

    expect(adminCache.cachedCustomersData).toBeNull();
    expect(adminCache.cachedCouponsData).toBeNull();
  });

  it("3. troca de conta na mesma aba sem SIGNED_OUT explícito (tablet de balcão) zera os caches ao logar user-b", async () => {
    const { adminCache, callback } = await montarLogado();

    popularCachesDeAdmin(adminCache);
    expect(adminCache.cachedCustomersData).not.toBeNull();

    // Lojista B loga direto por cima — sessão de A expirou e o
    // `onAuthStateChange` recebe SIGNED_IN de outro uid, sem SIGNED_OUT no
    // meio. É o "caso real do tablet de balcão" citado nos vereditos.
    const cb = callback();
    await act(async () => {
      cb("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    expect(adminCache.cachedCustomersData).toBeNull();
    expect(adminCache.cachedCouponsData).toBeNull();
    expect(adminCache.cachedReviewsData).toBeNull();
    expect(adminCache.cachedQuestionsData).toBeNull();
  });
});
