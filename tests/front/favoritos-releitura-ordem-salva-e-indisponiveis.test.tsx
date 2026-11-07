// @vitest-environment jsdom
//
// FAVORITOS DE QUEM TEM CONTA (lote G6, rodada 22).
//
// (A) A lista não atualizava ao voltar ao app: só o evento `online` (e só com
// pendentes) relia. Agora `visibilitychange` visível relê, com intervalo mínimo
// de ~5 s, e só com conta.
// (B) "Ordem original" prometia a ordem em que a pessoa salvou, mas quem tem
// conta via a ordem do catálogo. A leitura traz `created_at` e a lista segue
// a ordem salva.
// (C) Favorito de produto pausado (ou fora do catálogo) sumia em silêncio.
// O contexto expõe `favoritosIndisponiveis` — só depois que o catálogo
// terminou de carregar e tem produtos.
import type { Context } from "react";
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const umProduto = (id: string, isActive = true) =>
  ({
    id,
    name: `Produto ${id}`,
    price: 20,
    stock: 4,
    isActive,
    images: [],
  }) as unknown as Product;

let productsDaLoja: Product[] = [];
let catalogoCarregando = false;
let catalogoDaRedeAplicado = true;
let catalogoErro = false;
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: productsDaLoja,
    loading: catalogoCarregando,
    catalogoDaRedeAplicado,
    catalogoErro,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    products: productsDaLoja,
    loadingProducts: catalogoCarregando,
    catalogoErro,
    catalogoDaRedeAplicado,
    fetchProducts: vi.fn(async () => {}),
  }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

let linhasDoServidor: { product_id: string; created_at?: string }[] = [];
const consultas = vi.fn();
const remocoes = vi.fn();
let falharRemocao = false;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: () => Promise.resolve({ data: null, error: null }),
        delete: () => ({
          eq: (campo: string, dono: string) => ({
            eq: (_campo: string, id: string) => {
              remocoes(campo, dono, id);
              if (falharRemocao)
                return Promise.resolve({ error: { message: "rede" } });
              linhasDoServidor = linhasDoServidor.filter(
                (p) => p.product_id !== id,
              );
              return Promise.resolve({ error: null });
            },
          }),
        }),
        select: () => ({
          eq: () => {
            consultas();
            return Promise.resolve({ data: linhasDoServidor, error: null });
          },
        }),
      };
    },
    channel: () => ({
      on() {
        return this;
      },
      subscribe: () => ({}),
    }),
    removeChannel: () => Promise.resolve(),
  },
}));

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno dos
// testes irmãos de FavoritesContext.
function criarStorageFake() {
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

type Ctx = {
  favorites: Product[];
  favoritosIndisponiveis: number;
  limparIndisponiveis: () => Promise<void>;
};
let ultimoContexto: unknown = null;
let Tela: typeof import("@/views/customer/FavoritesView").FavoritesView | null =
  null;
function Sonda({ contexto }: { contexto: Context<any> }) {
  const ctx = useContext(contexto);
  useEffect(() => {
    ultimoContexto = ctx;
  });
  return Tela ? (
    <Tela
      favorites={ctx.favorites}
      loading={false}
      onToggleFavorite={() => {}}
      onProductClick={() => {}}
      onNavigate={() => {}}
    />
  ) : null;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let agora = 1_000_000;
let visibilidade: "visible" | "hidden" = "visible";

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  usuarioDaVez = null;
  productsDaLoja = [];
  catalogoCarregando = false;
  catalogoDaRedeAplicado = true;
  catalogoErro = false;
  Tela = null;
  linhasDoServidor = [];
  falharRemocao = false;
  ultimoContexto = null;
  agora = 1_000_000;
  visibilidade = "visible";
  vi.spyOn(Date, "now").mockImplementation(() => agora);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilidade,
  });
  vi.stubGlobal("localStorage", criarStorageFake());
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Volta ao getter do jsdom.
  Reflect.deleteProperty(document, "visibilityState");
});

async function montar() {
  const { FavoritesProvider, FavoritesContext } = await import(
    "@/contexts/FavoritesContext"
  );
  await act(async () => {
    raiz.render(
      <FavoritesProvider>
        <Sonda contexto={FavoritesContext} />
      </FavoritesProvider>,
    );
  });
  await flush();
  return () => ultimoContexto as Ctx | null;
}

async function voltarAoApp() {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await flush();
}

describe("FavoritesContext — (A) relê ao voltar ao app", () => {
  it("aba volta a ficar visível depois de 5 s: consulta de novo e a lista muda", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a"), umProduto("b")];
    linhasDoServidor = [{ product_id: "a", created_at: "2026-01-01" }];
    const ctx = await montar();
    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["a"]);
    const antes = consultas.mock.calls.length;

    // Outro aparelho favoritou "b" enquanto este estava em segundo plano.
    linhasDoServidor = [
      { product_id: "a", created_at: "2026-01-01" },
      { product_id: "b", created_at: "2026-01-02" },
    ];
    agora += 6_000;
    await voltarAoApp();

    expect(consultas.mock.calls.length).toBe(antes + 1);
    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("dentro de 5 s da última leitura: não repete a consulta", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a")];
    linhasDoServidor = [{ product_id: "a", created_at: "2026-01-01" }];
    await montar();
    const antes = consultas.mock.calls.length;

    agora += 1_000;
    await voltarAoApp();
    expect(consultas.mock.calls.length).toBe(antes);

    // Passou o intervalo: uma consulta, e a rajada seguinte não repete.
    agora += 6_000;
    await voltarAoApp();
    expect(consultas.mock.calls.length).toBe(antes + 1);
    agora += 500;
    await voltarAoApp();
    expect(consultas.mock.calls.length).toBe(antes + 1);
  });

  it("aba indo para segundo plano (hidden): não consulta", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a")];
    linhasDoServidor = [{ product_id: "a", created_at: "2026-01-01" }];
    await montar();
    const antes = consultas.mock.calls.length;

    visibilidade = "hidden";
    agora += 6_000;
    await voltarAoApp();

    expect(consultas.mock.calls.length).toBe(antes);
  });

  it("visitante (sem conta): não consulta nada", async () => {
    usuarioDaVez = null;
    productsDaLoja = [umProduto("a")];
    await montar();

    agora += 6_000;
    await voltarAoApp();

    expect(consultas).not.toHaveBeenCalled();
  });

  it("desmontar tira o ouvinte: voltar ao app depois não consulta", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a")];
    linhasDoServidor = [{ product_id: "a", created_at: "2026-01-01" }];
    await montar();
    await act(async () => {
      raiz.unmount();
    });
    const antes = consultas.mock.calls.length;

    agora += 6_000;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(consultas.mock.calls.length).toBe(antes);
    // O afterEach desmonta de novo: recria a raiz para ele não falhar.
    raiz = createRoot(hospedeiro);
  });
});

describe("FavoritesContext — (B) ordem em que a pessoa salvou", () => {
  it("quem tem conta vê c, a, b (ordem salva), não a ordem do catálogo a, b, c", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a"), umProduto("b"), umProduto("c")];
    // O servidor devolve fora de ordem; vale o `created_at`.
    linhasDoServidor = [
      { product_id: "a", created_at: "2026-03-02T10:00:00Z" },
      { product_id: "b", created_at: "2026-03-03T10:00:00Z" },
      { product_id: "c", created_at: "2026-03-01T10:00:00Z" },
    ];

    const ctx = await montar();

    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  it("produto pausado continua fora da lista, sem desarrumar a ordem do resto", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a"), umProduto("b", false), umProduto("c")];
    linhasDoServidor = [
      { product_id: "c", created_at: "2026-03-01T10:00:00Z" },
      { product_id: "b", created_at: "2026-03-02T10:00:00Z" },
      { product_id: "a", created_at: "2026-03-03T10:00:00Z" },
    ];

    const ctx = await montar();

    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["c", "a"]);
  });

  it("linhas sem created_at (resposta antiga): mantém a ordem em que vieram", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a"), umProduto("b"), umProduto("c")];
    linhasDoServidor = [
      { product_id: "c" },
      { product_id: "a" },
      { product_id: "b" },
    ];

    const ctx = await montar();

    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
});

describe("FavoritesContext — (C) favoritos indisponíveis", () => {
  const dosTresIds = [
    { product_id: "a", created_at: "2026-03-01T10:00:00Z" },
    { product_id: "pausado", created_at: "2026-03-02T10:00:00Z" },
    { product_id: "sumiu", created_at: "2026-03-03T10:00:00Z" },
  ];

  it("catálogo carregado: conta o pausado e o que não está mais no catálogo", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a"), umProduto("pausado", false)];
    linhasDoServidor = dosTresIds;

    const ctx = await montar();

    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["a"]);
    expect(ctx()?.favoritosIndisponiveis).toBe(2);
  });

  it("limpa só os indisponíveis da própria conta e relê a lista", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a"), umProduto("pausado", false)];
    linhasDoServidor = dosTresIds;
    const ctx = await montar();
    expect(ctx()?.limparIndisponiveis).toBeTypeOf("function");
    await act(async () => {
      await ctx()?.limparIndisponiveis();
    });
    await flush();
    expect(remocoes.mock.calls).toEqual([
      ["user_id", "ana", "pausado"],
      ["user_id", "ana", "sumiu"],
    ]);
    expect(ctx()?.favoritosIndisponiveis).toBe(0);
    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["a"]);
  });

  it.each([
    { redeAplicada: false, erro: true },
    { redeAplicada: false, erro: false },
    { redeAplicada: true, erro: true },
  ])(
    "cópia local sem confirmação segura ($redeAplicada/$erro): não apaga nem oferece limpar",
    async ({ redeAplicada, erro }) => {
      usuarioDaVez = { id: "ana" };
      productsDaLoja = [umProduto("a")];
      linhasDoServidor = [{ product_id: "novo" }];
      catalogoDaRedeAplicado = redeAplicada;
      catalogoErro = erro;
      Tela = (await import("@/views/customer/FavoritesView")).FavoritesView;
      const ctx = await montar();
      expect.soft(hospedeiro.textContent).not.toContain("Limpar indisponíveis");
      expect.soft(ctx()?.favoritosIndisponiveis).toBe(0);

      await act(async () => {
        await ctx()?.limparIndisponiveis();
      });

      expect(remocoes).not.toHaveBeenCalled();
      expect(ctx()?.favoritosIndisponiveis).toBe(0);
      expect(hospedeiro.textContent).not.toContain("Limpar indisponíveis");
      expect(hospedeiro.textContent).not.toContain("não está disponível");
      expect(linhasDoServidor).toEqual([{ product_id: "novo" }]);
    },
  );

  it("rede aplicada: a tela oferece limpar e duas remoções mostram um único aviso", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a")];
    linhasDoServidor = dosTresIds.slice(1);
    Tela = (await import("@/views/customer/FavoritesView")).FavoritesView;
    const ctx = await montar();
    expect(hospedeiro.textContent).toContain("Limpar indisponíveis");

    await act(async () => {
      await ctx()?.limparIndisponiveis();
    });

    expect(remocoes).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("2 favoritos removidos");
    expect(toast.error).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain("Limpar indisponíveis");
  });

  it("duas falhas na limpeza: um aviso de falha e nenhum sucesso", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a")];
    linhasDoServidor = dosTresIds.slice(1);
    falharRemocao = true;
    const ctx = await montar();

    await act(async () => {
      await ctx()?.limparIndisponiveis();
    });

    expect(remocoes).toHaveBeenCalledTimes(2);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível remover todos os favoritos indisponíveis",
    );
    expect(ctx()?.favoritosIndisponiveis).toBe(2);
    expect(linhasDoServidor).toEqual(dosTresIds.slice(1));
  });

  it("catálogo ainda carregando: NÃO conta (ausente pode ser só atraso)", async () => {
    usuarioDaVez = { id: "ana" };
    catalogoCarregando = true;
    productsDaLoja = [umProduto("a")];
    linhasDoServidor = dosTresIds;

    const ctx = await montar();

    expect(ctx()?.favoritosIndisponiveis).toBe(0);
  });

  it("catálogo vazio (falhou ou ainda sem nada): NÃO conta", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [];
    linhasDoServidor = dosTresIds;

    const ctx = await montar();

    expect(ctx()?.favoritosIndisponiveis).toBe(0);
  });

  it("todos disponíveis: zero", async () => {
    usuarioDaVez = { id: "ana" };
    productsDaLoja = [umProduto("a"), umProduto("pausado")];
    linhasDoServidor = dosTresIds.slice(0, 2);

    const ctx = await montar();

    expect(ctx()?.favoritosIndisponiveis).toBe(0);
  });

  it("visitante (sem conta): inalterado, zero", async () => {
    usuarioDaVez = null;
    productsDaLoja = [umProduto("a", false)];

    const ctx = await montar();

    expect(ctx()?.favoritosIndisponiveis).toBe(0);
  });
});
