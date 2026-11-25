// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) na limpeza do "Sair" (AuthContext): três
// apagamentos sem nenhum teste. Cada um deixa dado pessoal para a PRÓXIMA
// pessoa que abrir o app no mesmo aparelho (balcão, tablet compartilhado):
//   - `ikcous_recently_viewed` (chave antiga de "vistos recentemente");
//   - `ikcous_is_admin_<qualquer conta>` (o atalho "é lojista?" de OUTRA conta
//     que já passou por este aparelho — a varredura por prefixo, não a chave
//     da conta que está saindo);
//   - o cache de avaliações por produto (pode trazer avaliação ainda não
//     aprovada e o nome de quem a escreveu).
// E o controle: o que NÃO é da conta (tema, rascunho por usuário) fica.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

function Sonda({ authContext }: { readonly authContext: React.Context<any> }) {
  useContext(authContext);
  return null;
}

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno dos
// outros testes de AuthContext.
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

const todasAsChaves = () =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));

describe("Sair: chaves esquecidas que ficariam para a próxima pessoa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aoMudarAuth: AuthChangeCallback;

  beforeAll(async () => {
    // Aquece o import pesado do provider (a 1ª compilação do Vite é lenta).
    await import("@/contexts/AuthContext");
  }, 60_000);

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: null,
    } as never);
    vi.mocked(supabase.auth.onAuthStateChange).mockImplementation(((
      cb: AuthChangeCallback,
    ) => {
      aoMudarAuth = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }) as never);

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperar();
    });
    await act(async () => {
      await aoMudarAuth("SIGNED_IN", {
        user: { id: "user-a", app_metadata: {} },
        access_token: "tok-user-a",
      });
      await esperar();
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("apaga os vistos recentes, o atalho de lojista de QUALQUER conta e o cache de avaliações", async () => {
    const { REVIEWS_CACHE_KEY_PREFIX } = await import(
      "@/lib/cache-de-avaliacoes"
    );
    localStorage.setItem("ikcous_recently_viewed", '["p1","p2"]');
    localStorage.setItem("ikcous_is_admin_outra-conta", "true");
    localStorage.setItem(`${REVIEWS_CACHE_KEY_PREFIX}produto-1`, "[]");

    await act(async () => {
      await aoMudarAuth("SIGNED_OUT", null);
      await esperar();
    });

    expect(localStorage.getItem("ikcous_recently_viewed")).toBeNull();
    expect(localStorage.getItem("ikcous_is_admin_outra-conta")).toBeNull();
    expect(
      localStorage.getItem(`${REVIEWS_CACHE_KEY_PREFIX}produto-1`),
    ).toBeNull();
  });

  it("controle: o que não é da conta fica (tema, rascunho por usuário, filtro de lista)", async () => {
    localStorage.setItem("ikcous_theme", "dark");
    localStorage.setItem("admin_pdv_venda_draft:user-a", '{"itens":[]}');
    localStorage.setItem("admin_orders_view_mode", "cards");
    localStorage.setItem("ikcous_recently_viewed", '["p1"]');

    await act(async () => {
      await aoMudarAuth("SIGNED_OUT", null);
      await esperar();
    });

    const restantes = todasAsChaves();
    expect(restantes).toContain("ikcous_theme");
    expect(restantes).toContain("admin_pdv_venda_draft:user-a");
    expect(restantes).toContain("admin_orders_view_mode");
    expect(restantes).not.toContain("ikcous_recently_viewed");
  });
});
