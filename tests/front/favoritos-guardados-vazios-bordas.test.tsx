// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026): o filtro `entradaLocalValida` do
// FavoritesContext aceitava, sem nenhum teste notar, texto vazio ("") e
// produto com `id` vazio. O teste vizinho
// (`favoritos-guardados-com-formato-ruim-nao-derrubam-a-loja`) só olha a lista
// FILTRADA pelo catálogo, e um id "" nunca existe no catálogo: o lixo passava
// escondido. O que ele estraga de verdade é o DISCO e a fila: o "" ficava
// gravado para sempre ao lado dos favoritos bons e inflava o contador de
// "favoritos ainda sendo salvos".
//
// Mutantes equivalentes (sem teste possível, anotados de propósito):
//   - tirar o `Array.isArray(lista)` de `normalizarEntradasLocais`: o hook
//     `useLocalStorage` já descarta, antes, qualquer valor guardado que não
//     seja lista (src/hooks/useLocalStorage.ts:10), então a guarda é defesa
//     em dobro; os casos "não é lista" abaixo seguem protegendo o conjunto;
//   - `!haBalde ||` e `baldeAnterior !== null` em `guardarFilaDoLogin`: sem
//     balde do visitante não há o que remover nem restaurar, o resultado é o
//     mesmo (só muda uma tentativa de gravação a mais, que falha igual);
//   - `Number.isNaN(ta) || Number.isNaN(tb)` por `&&` em
//     `ordenarPorQuandoFoiSalvo`: o comparador devolveria `NaN`, e a
//     especificação do `sort` trata `NaN` como 0 — o mesmo `return 0`.
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FavoritesContext as FavoritesContextReal } from "@/contexts/FavoritesContext";
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

const conta = { id: "conta-teste" };
let temConta = false;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: temConta ? conta : null }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      if (temConta) {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
          // A fila da conta tenta subir; sem rede, ela fica retida.
          upsert: () =>
            Promise.resolve({ data: null, error: new Error("sem rede") }),
        };
      }
      throw new Error("visitante sem conta não deveria tocar o servidor");
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

type ContextoDeFavoritos = NonNullable<
  React.ContextType<typeof FavoritesContextReal>
>;

let ultimoContexto: ContextoDeFavoritos | undefined;
function Sonda({
  contexto,
}: {
  readonly contexto: React.Context<ContextoDeFavoritos | undefined>;
}) {
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
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

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
  return ultimoContexto;
}

const guardados = () =>
  JSON.parse(storageFake.getItem(FAVORITES_KEY) as string) as unknown;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  productsDaLoja = [produto("a"), produto("b"), produto("p1")];
  ultimoContexto = undefined;
  temConta = false;
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
  // Aquece o import pesado (a 1ª compilação do Vite estoura prazo).
  await import("@/contexts/FavoritesContext");
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("favoritos do aparelho — texto vazio e id vazio não ficam gravados", () => {
  it("texto vazio junto de um favorito bom: o '' não conta e some do disco no próximo toque", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["", "a"]));
    const ctx = await montar();

    expect(ctx?.isFavorite("")).toBe(false);
    expect(ctx?.isFavorite("a")).toBe(true);

    await act(async () => {
      ctx?.toggleFavorite(produto("p1"));
    });
    await flush();

    expect(guardados()).toEqual(["a", "p1"]);
  });

  it("produto de formato antigo com id vazio: não conta e não vai para o disco", async () => {
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify([{ ...produto("a"), id: "" }, "b"]),
    );
    const ctx = await montar();

    expect(ctx?.isFavorite("")).toBe(false);
    expect(ctx?.favorites.map((p) => p.id)).toEqual(["b"]);

    await act(async () => {
      ctx?.toggleFavorite(produto("p1"));
    });
    await flush();

    expect(guardados()).toEqual(["b", "p1"]);
  });

  it.each([
    ["objeto solto", { a: 1 }],
    ["texto solto", "a"],
    ["número", 5],
    ["verdadeiro", true],
  ])(
    "o que está guardado não é uma lista (%s): a loja monta vazia e o próximo toque regrava uma lista",
    async (_nome, guardado) => {
      storageFake.setItem(FAVORITES_KEY, JSON.stringify(guardado));
      const ctx = await montar();

      expect(ctx).toBeDefined();
      expect(ctx?.favorites).toEqual([]);
      expect(ctx?.isFavorite("a")).toBe(false);

      await act(async () => {
        ctx?.toggleFavorite(produto("p1"));
      });
      await flush();

      expect(guardados()).toEqual(["p1"]);
    },
  );

  it("só lixo vazio na lista: tirar um favorito que não existe não inventa entrada", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["", { id: "" }]));
    const ctx = await montar();
    expect(ctx?.favorites).toEqual([]);

    await act(async () => {
      ctx?.toggleFavorite(produto("a"));
    });
    await flush();

    expect(guardados()).toEqual(["a"]);
  });
});

describe("fila de favoritos da conta — entrada vazia não conta como pendente", () => {
  it("só o produto com id de verdade entra na contagem de pendentes", async () => {
    temConta = true;
    storageFake.setItem(
      `ikcous_favorites_pendentes:${conta.id}`,
      JSON.stringify([{ id: "" }, { id: "a" }, "b", "", { id: 7 }, null]),
    );

    const ctx = await montar();

    // `{id:"a"}` é a única linha válida: a fila guarda PRODUTO (objeto), nunca
    // texto solto, e produto sem id não existe.
    expect(ctx?.pendingCount).toBe(1);
  });
});
