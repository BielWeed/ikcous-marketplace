// @vitest-environment jsdom
//
// Favoritos do visitante (sem conta) com DUAS abas abertas. Os dois "abas"
// daqui são duas raízes React com um FavoritesProvider cada, sobre o MESMO
// disco (o `localStorage` é um só por navegador). Cada Provider tem a própria
// memória, como duas abas de verdade.
//
// Antes da correção, `setValue` do `useLocalStorage` partia da memória da aba
// (`valorRef`) e não do disco, e ninguém ouvia o evento `storage`:
//   - aba A favorita X, aba B (que ainda achava a lista vazia) favorita Y e
//     grava ["Y"] por cima de ["X"] — X some sem aviso;
//   - aba A remove X, aba B remove Y partindo da lista velha ["X","Y"] e grava
//     ["X"] — X, removido de propósito, volta;
//   - aba B nunca ficava sabendo do que a aba A mudou;
//   - quem entrava na conta na aba B subia para a conta um favorito que a
//     aba A já tinha tirado do aparelho.
//
// O evento `storage` real só chega às OUTRAS abas; aqui `window` é um só e o
// evento chega às duas. Isso é inofensivo: a aba que escreveu relê o disco e
// encontra o que ela mesma gravou.
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

let productsDaLoja: Product[] = [];
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: productsDaLoja, loading: false }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

const upsertsFeitos: string[] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      upsert: (obj: { product_id: string }) => {
        upsertsFeitos.push(obj.product_id);
        return Promise.resolve({ data: [{}], error: null });
      },
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
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

function produto(id: string): Product {
  return {
    id,
    name: `Produto ${id}`,
    price: 10,
    stock: 5,
    isActive: true,
    images: [],
  } as unknown as Product;
}

interface Contexto {
  favorites: Product[];
  toggleFavorite: (p: Product) => void;
  isFavorite: (id: string) => boolean;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let storageFake: ReturnType<typeof criarStorageFake>;
interface Aba {
  raiz: Root;
  no: HTMLDivElement;
  ctx: Contexto | null;
}
let abas: Aba[] = [];

function Sonda({
  contexto,
  aoLer,
}: {
  contexto: Context<any>;
  aoLer: (c: Contexto) => void;
}) {
  const ctx = useContext(contexto);
  useEffect(() => {
    aoLer(ctx);
  });
  return null;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function abrirAba(): Promise<Aba> {
  const { FavoritesProvider, FavoritesContext } = await import(
    "@/contexts/FavoritesContext"
  );
  const no = document.createElement("div");
  document.body.appendChild(no);
  const aba = { raiz: createRoot(no), no, ctx: null as Contexto | null };
  abas.push(aba);
  await act(async () => {
    aba.raiz.render(
      <FavoritesProvider>
        <Sonda
          contexto={FavoritesContext}
          aoLer={(c) => {
            aba.ctx = c;
          }}
        />
      </FavoritesProvider>,
    );
  });
  await flush();
  return aba;
}

async function recarregarAba(aba: Aba) {
  const { FavoritesProvider, FavoritesContext } = await import(
    "@/contexts/FavoritesContext"
  );
  await act(async () => {
    aba.raiz.render(
      <FavoritesProvider>
        <Sonda
          contexto={FavoritesContext}
          aoLer={(c) => {
            aba.ctx = c;
          }}
        />
      </FavoritesProvider>,
    );
  });
  await flush();
}

async function tocar(aba: Aba, id: string) {
  await act(async () => {
    aba.ctx?.toggleFavorite(produto(id));
  });
  await flush();
}

// O navegador avisa as outras abas de que a chave mudou no disco.
async function avisarMudancaNoDisco(chave: string | null = FAVORITES_KEY) {
  await act(async () => {
    window.dispatchEvent(new StorageEvent("storage", { key: chave }));
  });
  await flush();
}

function idsNoDisco(): string[] {
  const raw = storageFake.getItem(FAVORITES_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  upsertsFeitos.length = 0;
  usuarioDaVez = null;
  productsDaLoja = [produto("p1"), produto("p2"), produto("p3")];
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
  abas = [];
});

afterEach(() => {
  for (const aba of abas) {
    act(() => {
      aba.raiz.unmount();
    });
    aba.no.remove();
  }
  vi.unstubAllGlobals();
});

describe("favoritos do visitante com duas abas abertas", () => {
  it("cada aba favorita um produto antes de saber da outra: os dois ficam no aparelho", async () => {
    const a = await abrirAba();
    const b = await abrirAba();

    await tocar(a, "p1");
    // Nenhum aviso de `storage` chegou a B ainda (a janela de corrida): B
    // grava a partir do que está no DISCO, não da lista vazia que tem na memória.
    await tocar(b, "p2");

    expect(idsNoDisco()).toEqual(["p1", "p2"]);
  });

  it("cada aba remove um favorito antes de saber da outra: nenhum removido volta", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["p1", "p2"]));
    const a = await abrirAba();
    const b = await abrirAba();

    await tocar(a, "p1"); // remove p1 -> disco ["p2"]
    await tocar(b, "p2"); // B ainda acha que tem [p1,p2]; remove p2

    expect(idsNoDisco()).toEqual([]);
  });

  it("a aba que não mexeu passa a ver o favorito da outra assim que o disco muda", async () => {
    const a = await abrirAba();
    const b = await abrirAba();
    expect(b.ctx?.isFavorite("p1")).toBe(false);

    await tocar(a, "p1");
    await avisarMudancaNoDisco();

    expect(b.ctx?.isFavorite("p1")).toBe(true);
    expect(b.ctx?.favorites.map((p) => p.id)).toEqual(["p1"]);
  });

  it("a aba vê a remoção feita na outra (inclusive a chave apagada do disco)", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["p1"]));
    const a = await abrirAba();
    const b = await abrirAba();
    expect(b.ctx?.isFavorite("p1")).toBe(true);

    await tocar(a, "p1");
    // Quem esvazia o aparelho (sair da conta, limpar dados) remove a chave.
    storageFake.removeItem(FAVORITES_KEY);
    await avisarMudancaNoDisco();

    expect(b.ctx?.isFavorite("p1")).toBe(false);
    expect(b.ctx?.favorites).toEqual([]);
  });

  it("mudança em OUTRA chave do aparelho não mexe nos favoritos da aba", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["p1"]));
    const b = await abrirAba();
    storageFake.setItem("outra_chave", JSON.stringify(["x"]));
    await avisarMudancaNoDisco("outra_chave");
    expect(b.ctx?.isFavorite("p1")).toBe(true);
  });

  it("disco com texto quebrado: tocar no coração não estoura e regrava uma lista válida", async () => {
    const a = await abrirAba();
    storageFake.setItem(FAVORITES_KEY, "{lixo");
    await tocar(a, "p1");
    expect(idsNoDisco()).toEqual(["p1"]);
    expect(a.ctx?.isFavorite("p1")).toBe(true);
  });

  it("login na aba B depois de a aba A tirar o favorito: a conta não recebe o que o aparelho já não tem", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["p1", "p2"]));
    const a = await abrirAba();
    const b = await abrirAba();

    await tocar(a, "p1"); // disco ["p2"]
    await avisarMudancaNoDisco();
    expect(b.ctx?.isFavorite("p1")).toBe(false);

    usuarioDaVez = { id: "u1" };
    await recarregarAba(b);
    await flush();

    expect(upsertsFeitos).toEqual(["p2"]);
  });
});
