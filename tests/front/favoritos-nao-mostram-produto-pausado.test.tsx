// @vitest-environment jsdom
//
// FAVORITOS NÃO MOSTRAM PRODUTO PAUSADO (rodada 5, achado 3).
//
// O dono da loja, logado, tem o catálogo INTEIRO (inclusive pausados). A lista
// de favoritos não filtrava `isActive`: o item pausado aparecia com botão de
// adicionar ao carrinho, e a contagem do menu de baixo e o cabeçalho "N
// produtos que você salvou" o incluíam. Para o visitante, o retrato congelado
// do toque no coração também não pode vencer um catálogo que já diz "pausado".
import type { Context } from "react";
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const FAVORITES_KEY = "ikcous_favorites";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const umProduto = (id: string, isActive: boolean) =>
  ({
    id,
    name: `Produto ${id}`,
    price: 20,
    stock: 4,
    isActive,
    images: [],
  }) as unknown as Product;

let productsDaLoja: Product[] = [];
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: productsDaLoja, loading: false }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: () => Promise.resolve({ data: null, error: null }),
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [{ product_id: "ativo" }, { product_id: "pausado" }],
              error: null,
            }),
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

let ultimoContexto: unknown = null;
function Sonda({ contexto }: { contexto: Context<any> }) {
  const ctx = useContext(contexto);
  useEffect(() => {
    ultimoContexto = ctx;
  });
  return null;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let storageFake: ReturnType<typeof criarStorageFake>;

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
  ultimoContexto = null;
  storageFake = criarStorageFake();
  vi.stubGlobal("localStorage", storageFake);
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
  vi.unstubAllGlobals();
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
  return () => ultimoContexto as { favorites: Product[] } | null;
}

describe("FavoritesContext — produto pausado não aparece em Favoritos", () => {
  it("dono logado: o catálogo traz o pausado, mas a lista (e a contagem) só tem o ativo", async () => {
    usuarioDaVez = { id: "dono" };
    productsDaLoja = [umProduto("ativo", true), umProduto("pausado", false)];

    const ctx = await montar();

    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["ativo"]);
  });

  it("visitante: o catálogo já diz 'pausado' e o retrato antigo (ativo) não o traz de volta", async () => {
    // Formato antigo: o Product inteiro, ainda "ativo", vira retrato de reserva.
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify([umProduto("pausado", true), umProduto("ativo", true)]),
    );
    productsDaLoja = [umProduto("ativo", true), umProduto("pausado", false)];

    const ctx = await montar();

    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["ativo"]);
  });

  it("CONTROLE: produto que o catálogo não devolve segue na lista pelo retrato (não some sem explicação)", async () => {
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify([umProduto("fora-do-catalogo", true)]),
    );
    productsDaLoja = [umProduto("ativo", true)];

    const ctx = await montar();

    expect(ctx()?.favorites.map((p) => p.id)).toEqual(["fora-do-catalogo"]);
  });

  it("CONTROLE: produto ativo reativado volta a aparecer", async () => {
    usuarioDaVez = { id: "dono" };
    productsDaLoja = [umProduto("ativo", true), umProduto("pausado", true)];

    const ctx = await montar();

    expect(
      ctx()
        ?.favorites.map((p) => p.id)
        .sort(),
    ).toEqual(["ativo", "pausado"]);
  });
});
