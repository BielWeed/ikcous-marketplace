// @vitest-environment jsdom
//
// Favoritos do visitante vivem no aparelho (`ikcous_favorites`) e essa chave é
// PRESERVADA pela recuperação do app ("Recarregar" mantém o prefixo `ikcous_`).
// Um valor com formato ruim (`[null]`, `[1]`, `[{}]`...) fazia `entrada.id`
// lançar DENTRO do provedor que envolve a loja inteira: "Algo deu errado" e o
// botão de recarregar não ajudava, porque o valor ruim continuava lá.
//
// Agora a leitura descarta o que não é id (string não vazia) nem produto com
// `id` string não vazio, sem lançar, e o resto da lista segue valendo.
//
// Vermelho contra o código antigo: o `render` lança "Cannot read properties of
// null (reading 'id')" (ou devolve favorito `undefined`) e a Sonda nunca lê o
// contexto.
import type { Context } from "react";
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
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
  readonly contexto: Context<ContextoDeFavoritos | undefined>;
}) {
  const ctx = useContext(contexto);
  // Espelha fora do render (efeito) — a regra de pureza do React.
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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
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

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  productsDaLoja = [produto("a"), produto("b"), produto("p1")];
  ultimoContexto = undefined;
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

describe("FavoritesContext — favoritos guardados com formato ruim não derrubam a loja", () => {
  it.each([
    ["null dentro da lista", [null]],
    ["número dentro da lista", [1]],
    ["objeto vazio", [{}]],
    ["objeto com id vazio", [{ id: "" }]],
    ["objeto com id que não é texto", [{ id: 7 }]],
    ["texto vazio", [""]],
    ["lista dentro da lista", [["a"]]],
  ])(
    "%s: a loja monta e a lista de favoritos fica vazia",
    async (_nome, guardado) => {
      storageFake.setItem(FAVORITES_KEY, JSON.stringify(guardado));

      const ctx = await montar();

      expect(ctx).toBeDefined();
      expect(ctx?.favorites).toEqual([]);
      expect(ctx?.isFavorite("a")).toBe(false);
    },
  );

  it("mistura de válidas e inválidas: só as válidas valem", async () => {
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify(["a", null, { id: "b" }, 3, {}]),
    );

    const ctx = await montar();

    expect(ctx?.favorites.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(ctx?.isFavorite("a")).toBe(true);
    expect(ctx?.isFavorite("b")).toBe(true);
  });

  it("favoritar depois de um valor ruim funciona e regrava o disco limpo", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["a", null, 1]));

    const ctx = await montar();
    await act(async () => {
      ctx?.toggleFavorite(produto("p1"));
    });
    await flush();

    expect(ultimoContexto?.isFavorite("p1")).toBe(true);
    expect(JSON.parse(storageFake.getItem(FAVORITES_KEY) as string)).toEqual([
      "a",
      "p1",
    ]);
  });

  it("lista só de ids continua igual", async () => {
    storageFake.setItem(FAVORITES_KEY, JSON.stringify(["a", "b"]));

    const ctx = await montar();

    expect(ctx?.favorites.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("formato antigo (Product inteiro) continua migrando para só o id", async () => {
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify([{ ...produto("p1"), name: "Retrato velho" }, null]),
    );

    const ctx = await montar();

    expect(ctx?.favorites.map((p) => p.id)).toEqual(["p1"]);
    expect(ctx?.favorites[0].name).toBe("Produto p1");
    expect(JSON.parse(storageFake.getItem(FAVORITES_KEY) as string)).toEqual([
      "p1",
    ]);
  });
});
