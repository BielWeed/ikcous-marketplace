// @vitest-environment jsdom
//
// Depois de "Sair", as avaliações do último produto visto ficavam guardadas no
// aparelho (`localStorage`, chave `ikcous_reviews_cache_<produto>`, e um mapa em
// memória) e o hook as mostrava para a próxima pessoa antes de a rede
// responder. Para a lojista essa lista inclui avaliações ainda não aprovadas,
// com o nome do autor; para a cliente, as pendentes dela.
//
// Mesmo desenho de tests/front/admin-cache-limpa-no-logout.test.tsx: sem
// @testing-library/react, `createRoot` + `act`, Sonda que reporta o contexto, e
// `vi.resetModules()` + `await import(...)` para o AuthContext e o módulo do
// cache virem da MESMA instância.
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

const PRODUTO = "produto-visto-pela-lojista";
const CHAVE = `ikcous_reviews_cache_${PRODUTO}`;
const AVALIACAO_PENDENTE = [
  {
    id: "av-1",
    userName: "Maria Autora",
    rating: 5,
    comment: "ainda não aprovada",
    approved: false,
  },
] as any;

describe("avaliações guardadas — apagadas no logout e na troca de usuário", () => {
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

  /** Monta o Provider sem sessão inicial, loga "user-a" e devolve o módulo do
   * cache de avaliações da MESMA instância que o AuthContext importou. */
  async function montarLogado() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const cache = await import("@/lib/cache-de-avaliacoes");
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
    await act(async () => {
      callback("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    return { cache, callback: () => callback, aoAtualizar };
  }

  function guardarListaDaLojista(cache: {
    updateReviewsCache: (id: string, lista: any[]) => void;
    getReviewsCache: (id: string) => unknown;
  }) {
    cache.updateReviewsCache(PRODUTO, AVALIACAO_PENDENTE);
    // Sanidade: o hook leria esta lista antes da rede responder.
    expect(cache.getReviewsCache(PRODUTO)).toEqual(AVALIACAO_PENDENTE);
    expect(localStorage.getItem(CHAVE)).not.toBeNull();
  }

  it("1. SIGNED_OUT apaga a chave do localStorage e esvazia o mapa em memória", async () => {
    const { cache, callback } = await montarLogado();
    guardarListaDaLojista(cache);

    await act(async () => {
      callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    // Sem o prefixo na varredura, a chave continua aqui.
    expect(localStorage.getItem(CHAVE)).toBeNull();
    // Sem esvaziar o mapa, o hook ainda recebe a lista antiga na montagem.
    expect(cache.getReviewsCache(PRODUTO)).toBeNull();
  });

  it("2. logout() com signOut() falhando (rede caída) também apaga as avaliações guardadas", async () => {
    const { cache, aoAtualizar } = await montarLogado();
    const { supabase } = await import("@/lib/supabase");
    guardarListaDaLojista(cache);

    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const estado = aoAtualizar.mock.calls.at(-1)?.[0] as Snapshot;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });

    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(cache.getReviewsCache(PRODUTO)).toBeNull();
  });

  it("3. troca direta de conta (user-a → user-b sem SIGNED_OUT) apaga as avaliações guardadas", async () => {
    const { cache, callback } = await montarLogado();
    guardarListaDaLojista(cache);

    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(cache.getReviewsCache(PRODUTO)).toBeNull();
  });

  it("4. enquanto a pessoa segue logada, o cache continua valendo", async () => {
    const { cache, callback } = await montarLogado();
    guardarListaDaLojista(cache);

    // Reemissão do navegador com o MESMO usuário: não é troca de conta.
    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    expect(cache.getReviewsCache(PRODUTO)).toEqual(AVALIACAO_PENDENTE);
    expect(localStorage.getItem(CHAVE)).not.toBeNull();
  });

  // Varrer o localStorage de frente para trás removendo durante a iteração
  // PULA chaves (o índice seguinte desliza para a posição já visitada): com
  // um produto só o defeito não aparece. Aqui são 4 produtos guardados,
  // vizinhos, e chaves de outro prefixo que precisam sobreviver.
  const PRODUTOS = ["p1", "p2", "p3", "p4"];
  const CHAVES_DE_AVALIACAO = PRODUTOS.map((p) => `ikcous_reviews_cache_${p}`);
  const CHAVES_DE_OUTRO_PREFIXO = ["ikcous_questions_cache_p1", "tema-escuro"];

  function guardarVariosProdutos(cache: {
    updateReviewsCache: (id: string, lista: any[]) => void;
  }) {
    localStorage.setItem(CHAVES_DE_OUTRO_PREFIXO[0] as string, "[]");
    // As chaves de avaliação ficam CONTÍGUAS (o pulo só acontece entre duas
    // chaves a apagar vizinhas); as alheias ficam antes e depois do bloco.
    for (const p of PRODUTOS) {
      cache.updateReviewsCache(p, AVALIACAO_PENDENTE);
    }
    for (const p of PRODUTOS) {
      localStorage.setItem(`ikcous_questions_cache_${p}_x`, "[]");
    }
    localStorage.setItem(CHAVES_DE_OUTRO_PREFIXO[1] as string, "claro");
    for (const chave of CHAVES_DE_AVALIACAO) {
      expect(localStorage.getItem(chave)).not.toBeNull();
    }
  }

  function esperarSoOutroPrefixo() {
    for (const chave of CHAVES_DE_AVALIACAO) {
      expect(localStorage.getItem(chave)).toBeNull();
    }
    for (const p of PRODUTOS) {
      // A chave de perguntas (público) e as alheias não são tocadas.
      expect(localStorage.getItem(`ikcous_questions_cache_${p}_x`)).toBe("[]");
    }
    expect(localStorage.getItem(CHAVES_DE_OUTRO_PREFIXO[0] as string)).toBe(
      "[]",
    );
    expect(localStorage.getItem(CHAVES_DE_OUTRO_PREFIXO[1] as string)).toBe(
      "claro",
    );
  }

  it("5. SIGNED_OUT com vários produtos guardados apaga TODAS as chaves de avaliação e só elas", async () => {
    const { cache, callback } = await montarLogado();
    guardarVariosProdutos(cache);

    await act(async () => {
      callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    esperarSoOutroPrefixo();
    for (const p of PRODUTOS) {
      expect(cache.getReviewsCache(p)).toBeNull();
    }
  });

  it("6. troca direta de conta com vários produtos guardados apaga TODAS as chaves de avaliação e só elas", async () => {
    const { cache, callback } = await montarLogado();
    guardarVariosProdutos(cache);

    await act(async () => {
      callback()("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    esperarSoOutroPrefixo();
    for (const p of PRODUTOS) {
      expect(cache.getReviewsCache(p)).toBeNull();
    }
  });
});
