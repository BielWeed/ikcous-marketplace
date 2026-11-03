// @vitest-environment jsdom
//
// "SAIR" ESQUECE A BUSCA DIGITADA NAS LISTAS DO PAINEL (caça 4, rodada 4,
// achado e5).
//
// As listas do painel (Pedidos, Perguntas, Avaliações) lembram o texto da busca
// no aparelho (`useLocalStorage`, chaves `admin_<lista>_search_query`). O texto
// pode ser o nome ou o WhatsApp de uma cliente. Depois do "Sair", a próxima
// pessoa a entrar no mesmo tablet abria a lista já filtrada por aquela cliente.
//
// O que muda: o "Sair" e a troca direta de conta apagam toda chave
// `admin_*_search_query`. O que é preferência do aparelho (modo de lista,
// tema, filtros de status) continua.
//
// Molde: tests/front/avaliacoes-guardadas-limpa-no-logout.test.tsx.
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type AuthChangeCallback = (
  event: string,
  session: unknown,
) => void | Promise<void>;

interface Snapshot {
  logout: () => Promise<void>;
}

function Sonda({
  authContext,
  aoAtualizar,
}: {
  readonly authContext: React.Context<any>;
  readonly aoAtualizar: (snapshot: Snapshot) => void;
}) {
  const ctx = useContext(authContext) as { logout: () => Promise<void> };
  aoAtualizar({ logout: ctx.logout });
  return null;
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno dos
// outros testes de logout.
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

const BUSCAS = {
  admin_orders_search_query: '"11 99999-1234"',
  admin_qa_search_query: '"maria"',
  admin_reviews_search_query: '"maria"',
};

/** Preferências do aparelho que NÃO são dado de cliente e devem ficar. */
const PREFERENCIAS = {
  admin_orders_view_mode: "cards",
  admin_products_view_mode: "list",
  admin_orders_filter_v2: '"pending"',
  admin_orders_payment_filter: '"all"',
  admin_reviews_rating_filter: '"all"',
  admin_qa_filter: '"all"',
  // Chaves que apenas PARECEM com busca: não casam o padrão inteiro.
  admin_search_query_extra: "fica",
  outra_search_query: "fica",
  theme: "dark",
};

function gravarTudo() {
  for (const [k, v] of Object.entries({ ...BUSCAS, ...PREFERENCIAS })) {
    localStorage.setItem(k, v);
  }
}

function expectBuscasApagadasEPreferenciasIntactas() {
  for (const k of Object.keys(BUSCAS)) {
    expect(localStorage.getItem(k), k).toBeNull();
  }
  for (const [k, v] of Object.entries(PREFERENCIAS)) {
    expect(localStorage.getItem(k), k).toBe(v);
  }
}

describe("Sair e trocar de conta esquecem a busca digitada nas listas do painel", () => {
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

  async function montarLogado() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: true,
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
    await act(async () => {
      callback("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });
    return { callback: () => callback, aoAtualizar, supabase };
  }

  it("SIGNED_OUT: as buscas do painel somem e as preferências ficam", async () => {
    const { callback } = await montarLogado();
    gravarTudo();
    // Controle: está tudo lá antes de sair.
    expect(localStorage.getItem("admin_orders_search_query")).toBe(
      '"11 99999-1234"',
    );

    await act(async () => {
      await callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    expectBuscasApagadasEPreferenciasIntactas();
  });

  it("troca direta de conta (A -> B, sem SIGNED_OUT): as buscas somem e as preferências ficam", async () => {
    const { callback } = await montarLogado();
    gravarTudo();

    await act(async () => {
      await callback()("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    expectBuscasApagadasEPreferenciasIntactas();
  });

  it("Sair com a rede caída (signOut falha) também esquece as buscas", async () => {
    const { aoAtualizar, supabase } = await montarLogado();
    gravarTudo();
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const estado = aoAtualizar.mock.calls.at(-1)?.[0] as Snapshot;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });

    expectBuscasApagadasEPreferenciasIntactas();
  });

  it("o mesmo usuário reanunciado (SIGNED_IN ao voltar para a aba) NÃO apaga a busca", async () => {
    const { callback } = await montarLogado();
    gravarTudo();

    await act(async () => {
      await callback()("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    expect(localStorage.getItem("admin_orders_search_query")).toBe(
      '"11 99999-1234"',
    );
  });

  it("sem nenhuma busca guardada, o Sair não quebra", async () => {
    const { callback } = await montarLogado();
    localStorage.setItem("admin_orders_view_mode", "cards");

    await act(async () => {
      await callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    expect(localStorage.getItem("admin_orders_view_mode")).toBe("cards");
  });
});
