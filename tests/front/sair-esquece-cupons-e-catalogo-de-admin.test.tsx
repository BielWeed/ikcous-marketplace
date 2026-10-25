// @vitest-environment jsdom
//
// "SAIR" NÃO DEIXA CUPOM NEM CATÁLOGO DE LOJISTA NO APARELHO (caça 4, A1,
// 24/10/2026).
//
// Tablet de balcão compartilhado: a lojista entra, o app grava no cofre local
// (IndexedDB `ikcous-datavault`) a lista de cupons (código, valor, limite) e o
// catálogo de ADMIN -- com custo e produtos inativos. Depois do "Sair" tudo
// continuava lá, legível no DevTools por quem pegasse o tablet, e a vitrine
// da PRÓXIMA abertura (offline) mostraria o catálogo com custo.
//
// O que o "Sair" e a troca direta de conta passam a fazer (sem nunca travar
// nem lançar erro):
//  - gaveta `coupons`: esvaziada SEMPRE (nada lê essa gaveta);
//  - gavetas `products` e `product_variants`: esvaziadas quando quem saiu era
//    LOJISTA. Cliente comum guarda só o catálogo público, que o app oferece
//    offline -- esse fica.
//
// Sem fake-indexeddb no projeto: o cofre é um dublê em memória que tem a
// MESMA interface do que o código usa (init/clear/count).
//
// Molde: tests/front/admin-cache-limpa-no-logout.test.tsx.
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cofre = vi.hoisted(() => {
  const gavetas = new Map<string, unknown[]>();
  return {
    gavetas,
    falhaAoAbrir: false,
    limparChamadas: [] as string[],
    vault: {
      clear: async (loja: string) => {
        cofre.limparChamadas.push(loja);
        gavetas.set(loja, []);
      },
      count: async (loja: string) => gavetas.get(loja)?.length ?? 0,
    },
  };
});

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn(async () => {
      if (cofre.falhaAoAbrir) throw new Error("IndexedDB indisponível");
      return cofre.vault;
    }),
  },
}));

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

// Node 25 pisa em `localStorage` global antes do jsdom -- mesmo contorno de
// admin-cache-limpa-no-logout.test.tsx.
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

/** O que o app deixa no cofre numa sessão de lojista (e, para o cliente comum,
 * só o catálogo público). */
function encherOCofre() {
  cofre.gavetas.set("coupons", [
    { id: "c1", code: "PROMO10", value: 10, usageLimit: 5 },
    { id: "c2", code: "SEGREDO50", value: 50 },
  ]);
  cofre.gavetas.set("products", [
    { id: "p1", name: "Camiseta", costPrice: 18, isActive: true },
    { id: "p2", name: "Bermuda (pausada)", costPrice: 25, isActive: false },
  ]);
  cofre.gavetas.set("product_variants", [{ id: "v1", productId: "p1" }]);
  cofre.gavetas.set("categories", [{ id: "k1", name: "Verão" }]);
}

describe("Sair e trocar de conta esquecem cupons e catálogo de lojista no cofre local", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    cofre.gavetas.clear();
    cofre.limparChamadas.length = 0;
    cofre.falhaAoAbrir = false;
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

  /** Monta o Provider, loga "user-a" e devolve o callback do
   * `onAuthStateChange`. `ehAdmin` decide o veredito da RPC `is_admin`. */
  async function montarLogado(ehAdmin: boolean) {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: ehAdmin,
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
    // Controle: o veredito do servidor chegou e ficou guardado -- sem isto, "o
    // lojista não foi reconhecido" passaria por "o código não limpa".
    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBe(
      ehAdmin ? "true" : "false",
    );
    return { callback: () => callback, aoAtualizar, supabase };
  }

  it("lojista que sai: cupons e catálogo de admin somem do cofre; o resto fica", async () => {
    const { callback } = await montarLogado(true);
    encherOCofre();
    expect(await cofre.vault.count("coupons")).toBe(2);

    await act(async () => {
      await callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    expect(await cofre.vault.count("coupons")).toBe(0);
    expect(await cofre.vault.count("products")).toBe(0);
    expect(await cofre.vault.count("product_variants")).toBe(0);
    // Só o que é de lojista: categorias são públicas e continuam.
    expect(await cofre.vault.count("categories")).toBe(1);
  });

  it("cliente comum que sai: cupons somem, mas o catálogo público (vitrine offline) FICA", async () => {
    const { callback } = await montarLogado(false);
    encherOCofre();

    await act(async () => {
      await callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    expect(await cofre.vault.count("coupons")).toBe(0);
    expect(await cofre.vault.count("products")).toBe(2);
    expect(await cofre.vault.count("product_variants")).toBe(1);
  });

  it("Sair com a rede caída (signOut falha) também limpa o cofre do lojista", async () => {
    const { aoAtualizar, supabase } = await montarLogado(true);
    encherOCofre();
    (
      supabase.auth.signOut as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ error: { message: "Failed to fetch" } });

    const estado = aoAtualizar.mock.calls.at(-1)?.[0] as Snapshot;
    await act(async () => {
      await estado.logout();
      await esperarMicrotarefas();
    });

    expect(await cofre.vault.count("coupons")).toBe(0);
    expect(await cofre.vault.count("products")).toBe(0);
  });

  it("troca direta de conta (lojista -> outra pessoa, sem SIGNED_OUT) também limpa", async () => {
    const { callback } = await montarLogado(true);
    encherOCofre();

    await act(async () => {
      await callback()("SIGNED_IN", sessaoDe("user-b"));
      await esperarMicrotarefas();
    });

    expect(await cofre.vault.count("coupons")).toBe(0);
    expect(await cofre.vault.count("products")).toBe(0);
    expect(await cofre.vault.count("product_variants")).toBe(0);
  });

  it("o mesmo usuário reanunciado (SIGNED_IN ao voltar para a aba) NÃO esvazia o cofre", async () => {
    const { callback } = await montarLogado(true);
    encherOCofre();

    await act(async () => {
      await callback()("SIGNED_IN", sessaoDe("user-a"));
      await esperarMicrotarefas();
    });

    expect(await cofre.vault.count("products")).toBe(2);
    expect(cofre.limparChamadas).toEqual([]);
  });

  it("cofre indisponível (IndexedDB negado): o Sair termina e as outras limpezas acontecem", async () => {
    const { callback } = await montarLogado(true);
    localStorage.setItem("marketplace_cart_v1", '{"itens":[1]}');
    cofre.falhaAoAbrir = true;

    await act(async () => {
      await callback()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });

    // Não lançou, e a limpeza do resto (carrinho, flag de admin) aconteceu.
    expect(localStorage.getItem("marketplace_cart_v1")).toBeNull();
    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBeNull();
  });
});
