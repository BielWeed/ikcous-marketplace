// @vitest-environment jsdom
//
// Achado 1 da onda 122 (login-por-codigo-no-front): o boot do AuthContext
// (initAuth e a sessao tardia) chamava `supabase.auth.signOut()` SEM escopo.
// O padrao do @supabase/auth-js e `{ scope: 'global' }`
// (node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:3414 e
// GoTrueAdminApi.js:65-70 -> `POST /logout?scope=global`), que REVOGA os
// refresh tokens da conta em TODOS os aparelhos. Resultado na rua: um aparelho
// que abre com uma sessao em cache invalida (ou um `getUser` com erro de
// classe nao prevista) derrubava a conta da pessoa no celular, no tablet e no
// computador. Com `{ scope: 'local' }` so a sessao DESTE aparelho e limpa —
// o mesmo que o `logout` (Sair) ja faz de proposito.
//
// Cada caso abaixo forca um dos 4 pontos do boot a deslogar e exige que o
// `signOut` receba EXATAMENTE `{ scope: "local" }` (e nunca seja chamado sem
// escopo). O comportamento local (sessao e usuario zerados neste aparelho)
// continua provado junto.
//
// Harness: o mesmo de auth-boot-verificacao-de-rede-nao-desloga.test.tsx (boot
// normal) e auth-sessao-tardia-valida-no-servidor.test.tsx (sessao tardia).
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

// @ts-expect-error flag interna do React, sem tipo publico.
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
  aoAtualizar({ hasSession: !!ctx.session, userId: ctx.user?.id ?? null });
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

const fn = (valor: unknown) => valor as ReturnType<typeof vi.fn>;

/** Reproduz o GoTrue real ao deslogar com sucesso: dispara SIGNED_OUT no
 * listener (que zera sessao/usuario e limpa os dados locais). */
function conectarSignOutRealista(supabase: any) {
  let callback: ((event: string, session: unknown) => unknown) | undefined;
  fn(supabase.auth.onAuthStateChange).mockImplementation(
    (cb: typeof callback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
  );
  fn(supabase.auth.signOut).mockImplementation(async () => {
    await callback?.("SIGNED_OUT", null);
    return { error: null };
  });
}

/** Exatamente UMA chamada de signOut, e com `{ scope: "local" }`. Se o boot
 * voltasse ao padrao do SDK (sem argumento = global), a lista seria `[[]]`. */
function esperarSignOutSoLocal(supabase: any) {
  expect(fn(supabase.auth.signOut).mock.calls).toEqual([[{ scope: "local" }]]);
}

// ---------------------------------------------------------------------------
// Boot normal: pontos ~932 (invalidez definitiva) e ~1001 (else final)
// ---------------------------------------------------------------------------
describe("AuthContext — o boot que desloga so derruba ESTE aparelho (scope local)", () => {
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

  async function bootComSessaoEmCache(
    respostaDoGetUser: { data: { user: null }; error: unknown },
    userId: string,
  ) {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");

    fn(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          user: { id: userId, app_metadata: {} },
          access_token: `tok-${userId}`,
        },
      },
      error: null,
    });
    fn(supabase.auth.getUser).mockResolvedValue(respostaDoGetUser);
    conectarSignOutRealista(supabase);

    const aoAtualizar = vi.fn();
    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    return { supabase, ultimo: aoAtualizar.mock.calls.at(-1)?.[0] as Snapshot };
  }

  const casos: Array<{
    nome: string;
    erro: unknown;
  }> = [
    {
      nome: "403 (ramo de invalidez definitiva, ~932)",
      erro: { status: 403, message: "Forbidden" },
    },
    {
      nome: "'Invalid token' (ramo de invalidez definitiva, ~932)",
      erro: { status: 401, message: "Invalid token: JWT has expired" },
    },
    {
      nome: "'not found' (ramo de invalidez definitiva, ~932)",
      erro: { status: 404, message: "User not found" },
    },
    {
      nome: "erro de classe NAO prevista, status 500 e mensagem 'x' (else final, ~1001)",
      erro: { status: 500, message: "x" },
    },
    {
      nome: "erro de classe NAO prevista, status 401 e mensagem 'x' (else final, ~1001)",
      erro: { status: 401, message: "x" },
    },
    {
      nome: "servidor sem erro e sem usuario (else final, ~1001)",
      erro: null,
    },
  ];

  it.each(casos)(
    "getUser com $nome: signOut so com { scope: 'local' } e a sessao deste aparelho zera",
    async ({ erro }) => {
      const { supabase, ultimo } = await bootComSessaoEmCache(
        { data: { user: null }, error: erro },
        "user-boot",
      );

      esperarSignOutSoLocal(supabase);
      // Comportamento local intacto: este aparelho fica deslogado.
      expect(ultimo.hasSession).toBe(false);
      expect(ultimo.userId).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Sessao tardia: pontos ~835 (invalidez definitiva) e ~880 (sem usuario)
// ---------------------------------------------------------------------------
describe("AuthContext — a sessao tardia que desloga so derruba ESTE aparelho (scope local)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let resolverGetSession: (valor: unknown) => void;
  let aoAtualizar: ReturnType<typeof vi.fn<(snapshot: Snapshot) => void>>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    aoAtualizar = vi.fn<(snapshot: Snapshot) => void>(() => {});
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

  async function bootTardioComGetUser(respostaDoGetUser: unknown) {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");

    // getSession pendura ate o teste resolver — a rede lenta do celular.
    resolverGetSession = () => {};
    fn(supabase.auth.getSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolverGetSession = resolve;
        }),
    );
    fn(supabase.auth.getUser).mockResolvedValue(respostaDoGetUser);
    // Listener registrado mas silencioso: o SIGNED_OUT nao e simulado, entao o
    // que zera o estado aqui e o proprio ramo da sessao tardia.
    fn(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    fn(supabase.auth.signOut).mockResolvedValue({ error: null });

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} aoAtualizar={aoAtualizar} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      resolverGetSession({
        data: {
          session: {
            access_token: "tok-tardio",
            user: { id: "user-tardio" },
          },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return { supabase, ultimo: aoAtualizar.mock.calls.at(-1)![0] as Snapshot };
  }

  const casos: Array<{ nome: string; resposta: unknown }> = [
    {
      nome: "'Invalid token' (~835)",
      resposta: {
        data: { user: null },
        error: { status: 401, message: "Invalid token: JWT has expired" },
      },
    },
    {
      nome: "'not found' (~835)",
      resposta: {
        data: { user: null },
        error: { status: 404, message: "User not found" },
      },
    },
    {
      nome: "403 (~835)",
      resposta: {
        data: { user: null },
        error: { status: 403, message: "Forbidden" },
      },
    },
    {
      nome: "servidor sem erro e sem usuario (~880)",
      resposta: { data: { user: null }, error: null },
    },
  ];

  it.each(casos)(
    "getUser com $nome: signOut so com { scope: 'local' } e o usuario deste aparelho zera",
    async ({ resposta }) => {
      const { supabase, ultimo } = await bootTardioComGetUser(resposta);

      esperarSignOutSoLocal(supabase);
      expect(ultimo.userId).toBeNull();
      expect(ultimo.hasSession).toBe(false);
    },
  );

  it("limite: getUser com erro nao classificado na sessao tardia NAO desloga (nem local, nem global)", async () => {
    const { supabase, ultimo } = await bootTardioComGetUser({
      data: { user: null },
      error: { status: 500, message: "x" },
    });

    expect(fn(supabase.auth.signOut)).not.toHaveBeenCalled();
    expect(ultimo.userId).toBe("user-tardio");
  });
});
