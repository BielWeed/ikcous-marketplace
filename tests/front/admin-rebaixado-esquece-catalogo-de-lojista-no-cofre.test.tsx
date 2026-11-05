// @vitest-environment jsdom
//
// ADMIN REBAIXADO PELA DONA NÃO FICA COM O CATÁLOGO DE LOJISTA NO APARELHO
// (rodada 8, 04/11/2026).
//
// Tablet de balcão compartilhado: o funcionário entra como lojista e o app
// guarda no cofre local (IndexedDB `ikcous-datavault`) o catálogo de ADMIN, com
// custo e produto pausado. A dona tira o cargo dele. Na recheca seguinte o
// servidor responde "não é admin" de verdade, e o AuthContext gravava "false"
// por cima da marca "true" -- e mais nada. O "Sair" decide limpar o catálogo
// de lojista olhando as marcas "true" do aparelho (`haMarcaDeLojistaNoAparelho`):
// com a marca já sobrescrita, o "Sair" não limpava `products` nem
// `product_variants`, e o custo de todos os produtos seguia legível no
// DevTools por quem pegasse o tablet.
//
// O que estes testes prendem: quando o veredito REAL do servidor passa a ser
// "não" e antes havia a marca de lojista (a do aparelho OU a confirmação desta
// sessão), o app esquece o catálogo de lojista do cofre e os caches de admin
// na hora. Nunca limpa quando:
//  - a pessoa nunca foi admin (o catálogo público é o que a vitrine usa
//    offline);
//  - o servidor não respondeu (erro de rede e estouro de tempo não são "não");
//  - o veredito é "sim";
//  - a resposta chega atrasada, depois de a pessoa ter saído ou trocado.
//
// Harness copiado de sair-esquece-cupons-e-catalogo-de-admin.test.tsx (cofre em
// memória, `localStorage` falso) e de auth-admin-recheca-de-fundo-nao-rebaixa-a-dona
// (fila controlada de chamadas `is_admin`).
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cofre = vi.hoisted(() => {
  const gavetas = new Map<string, unknown[]>();
  return {
    gavetas,
    limparChamadas: [] as string[],
    vault: {
      clear: async (loja: string) => {
        cofre.limparChamadas.push(loja);
        gavetas.set(loja, []);
      },
      deleteById: async () => {},
      count: async (loja: string) => gavetas.get(loja)?.length ?? 0,
    },
  };
});

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn(async () => cofre.vault),
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
    from: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type AuthChangeCallback = (
  event: string,
  session: unknown,
) => void | Promise<void>;

type Pendente = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

function Sonda({ authContext }: { readonly authContext: React.Context<any> }) {
  useContext(authContext);
  return null;
}

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Node 25 pisa em `localStorage` global antes do jsdom -- mesmo contorno dos
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

function sessaoDe(userId: string) {
  return {
    user: { id: userId, app_metadata: {} },
    access_token: `tok-${userId}`,
  };
}

/** O que o app deixa no cofre numa sessão de lojista. */
function encherOCofre() {
  cofre.gavetas.set("coupons", [{ id: "c1", code: "PROMO10", value: 10 }]);
  cofre.gavetas.set("products", [
    { id: "p1", name: "Camiseta", costPrice: 18, isActive: true },
    { id: "p2", name: "Bermuda (pausada)", costPrice: 25, isActive: false },
  ]);
  cofre.gavetas.set("product_variants", [{ id: "v1", productId: "p1" }]);
  cofre.gavetas.set("categories", [{ id: "k1", name: "Verão" }]);
}

describe("Admin rebaixado esquece o catálogo de lojista no cofre local", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetAllMocks();
    cofre.gavetas.clear();
    cofre.limparChamadas.length = 0;
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

  /** Boot sem sessão. Cada chamada `is_admin` entra na `fila` e só responde
   * quando o teste mandar. O plano B (`profiles`) falha como um 401. */
  async function montar() {
    vi.resetModules();
    const { AuthContext, AuthProvider } = await import(
      "@/contexts/AuthContext"
    );
    const admin = await import("@/utils/admin_cache");
    const { supabase } = await import("@/lib/supabase");

    (
      supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: null, error: { message: "401" } }),
          }),
        }),
      }),
    );
    const fila: Pendente[] = [];
    (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (nome: string) => {
        if (nome === "is_admin") {
          return new Promise((resolve, reject) => {
            fila.push({ resolve, reject });
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    );
    let callback: AuthChangeCallback = () => {};
    (
      supabase.auth.onAuthStateChange as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((cb: AuthChangeCallback) => {
      callback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    await act(async () => {
      raiz.render(
        <AuthProvider>
          <Sonda authContext={AuthContext} />
        </AuthProvider>,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    return { cb: () => callback, fila, admin };
  }

  async function entrar(
    ctx: { cb: () => AuthChangeCallback },
    evento: string,
    userId: string,
  ) {
    await act(async () => {
      ctx.cb()(evento, sessaoDe(userId));
      await esperarMicrotarefas();
    });
  }

  async function responder(pendente: Pendente, resposta: unknown) {
    await act(async () => {
      pendente.resolve(resposta);
      await esperarMicrotarefas();
    });
  }

  /** Primeiro login do lojista, confirmado pelo servidor nesta sessão. */
  async function entrarComoLojista(userId = "user-a") {
    const ctx = await montar();
    await entrar(ctx, "SIGNED_IN", userId);
    await responder(ctx.fila[0], { data: true, error: null });
    expect(localStorage.getItem(`ikcous_is_admin_${userId}`)).toBe("true");
    return ctx;
  }

  it("1. lojista confirmado nesta sessão que o servidor rebaixa: catálogo de admin e caches somem; o público fica", async () => {
    const ctx = await entrarComoLojista();
    encherOCofre();
    ctx.admin.setCachedCouponsData([{ id: "c1" }]);

    await entrar(ctx, "TOKEN_REFRESHED", "user-a");
    expect(ctx.fila.length).toBe(2); // a recheca saiu para a rede
    await responder(ctx.fila[1], { data: false, error: null });

    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBe("false");
    expect(await cofre.vault.count("products")).toBe(0);
    expect(await cofre.vault.count("product_variants")).toBe(0);
    expect(await cofre.vault.count("coupons")).toBe(0);
    // Só o que é de lojista: categorias são públicas e continuam.
    expect(await cofre.vault.count("categories")).toBe(1);
    expect(ctx.admin.cachedCouponsData).toBeNull();
  });

  it("2. a marca de lojista só existia no aparelho (app recém-aberto, sem confirmação): o 'não' real também limpa", async () => {
    const ctx = await montar();
    localStorage.setItem("ikcous_is_admin_user-a", "true");
    encherOCofre();

    await entrar(ctx, "SIGNED_IN", "user-a");
    await responder(ctx.fila[0], { data: false, error: null });

    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBe("false");
    expect(await cofre.vault.count("products")).toBe(0);
    expect(await cofre.vault.count("product_variants")).toBe(0);
  });

  it("3. outra aba já gravou 'false' no aparelho, mas esta sessão tinha confirmado o lojista: o 'não' real ainda limpa", async () => {
    const ctx = await entrarComoLojista();
    encherOCofre();
    localStorage.setItem("ikcous_is_admin_user-a", "false");

    await entrar(ctx, "SIGNED_IN", "user-a");
    await responder(ctx.fila[1], { data: false, error: null });

    expect(await cofre.vault.count("products")).toBe(0);
    expect(await cofre.vault.count("product_variants")).toBe(0);
  });

  it("4. quem nunca foi admin (veredito 'não' sem marca anterior): nada do cofre é tocado", async () => {
    const ctx = await montar();
    encherOCofre();

    await entrar(ctx, "SIGNED_IN", "cliente");
    await responder(ctx.fila[0], { data: false, error: null });

    expect(localStorage.getItem("ikcous_is_admin_cliente")).toBe("false");
    expect(cofre.limparChamadas).toEqual([]);
    expect(await cofre.vault.count("products")).toBe(2);
    expect(await cofre.vault.count("product_variants")).toBe(1);
    expect(await cofre.vault.count("coupons")).toBe(1);
  });

  it("5. cliente com marca 'false' recheca e segue 'não': nada do cofre é tocado", async () => {
    const ctx = await montar();
    localStorage.setItem("ikcous_is_admin_cliente", "false");
    encherOCofre();

    await entrar(ctx, "SIGNED_IN", "cliente");
    await responder(ctx.fila[0], { data: false, error: null });

    expect(cofre.limparChamadas).toEqual([]);
    expect(await cofre.vault.count("products")).toBe(2);
  });

  it("6. o servidor NÃO respondeu (erro de rede) com o lojista confirmado: não limpa nada e a marca segue 'true'", async () => {
    const ctx = await entrarComoLojista();
    encherOCofre();

    await entrar(ctx, "TOKEN_REFRESHED", "user-a");
    await act(async () => {
      ctx.fila[1].reject(new Error("fetch failed"));
      await esperarMicrotarefas();
    });

    expect(cofre.limparChamadas).toEqual([]);
    expect(await cofre.vault.count("products")).toBe(2);
    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBe("true");
  });

  it("7. a RPC e o plano B falham (401) com a marca 'true' só no aparelho: não é veredito, não limpa", async () => {
    const ctx = await montar();
    localStorage.setItem("ikcous_is_admin_user-a", "true");
    encherOCofre();

    await entrar(ctx, "SIGNED_IN", "user-a");
    await responder(ctx.fila[0], {
      data: null,
      error: { message: "JWT expired", status: 401 },
    });

    expect(cofre.limparChamadas).toEqual([]);
    expect(await cofre.vault.count("products")).toBe(2);
    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBe("true");
  });

  it("8. o servidor confirma que o lojista continua lojista: nada é limpo", async () => {
    const ctx = await entrarComoLojista();
    encherOCofre();

    await entrar(ctx, "TOKEN_REFRESHED", "user-a");
    await responder(ctx.fila[1], { data: true, error: null });

    expect(cofre.limparChamadas).toEqual([]);
    expect(await cofre.vault.count("products")).toBe(2);
    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBe("true");
  });

  it("9. 'não' real que chega atrasado, depois de a pessoa ter saído: descartado, não esvazia o catálogo de quem está no aparelho", async () => {
    const ctx = await entrarComoLojista();
    await entrar(ctx, "TOKEN_REFRESHED", "user-a");
    expect(ctx.fila.length).toBe(2);

    await act(async () => {
      await ctx.cb()("SIGNED_OUT", null);
      await esperarMicrotarefas();
    });
    // Depois do Sair: o aparelho guarda só o catálogo público.
    cofre.limparChamadas.length = 0;
    cofre.gavetas.set("products", [{ id: "p1", name: "Camiseta" }]);

    await responder(ctx.fila[1], { data: false, error: null });

    expect(cofre.limparChamadas).toEqual([]);
    expect(await cofre.vault.count("products")).toBe(1);
    expect(localStorage.getItem("ikcous_is_admin_user-a")).toBeNull();
  });
});
