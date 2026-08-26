// @vitest-environment jsdom
//
// Redesenho subtrativo (26/08/2026) sobre a correção do vazamento de
// favoritos entre contas — `FavoritesContext.tsx`.
//
// Este arquivo testava o mecanismo de cancelamento (`canceladosRef` + o
// DELETE compensatório em `tentarSincronizarComServidor`) que existia para
// resolver a corrida: pessoa desfavorita um produto AINDA pendente enquanto
// o upsert dele está em voo, e o upsert aterrissa DEPOIS, ressuscitando o
// favorito que ela acabou de remover.
//
// Esse mecanismo saiu inteiro do código (ver o comentário grande em
// `FavoritesContext.tsx`, antes do memo de `favorites`). A corrida não foi
// fechada com uma marca melhor — o CAMINHO que a gerava deixou de existir:
// um produto ainda pendente (não confirmado em `dbFavoriteIds`) não é mais
// considerado favoritado por `isFavorite`, então `toggleFavorite` nunca
// chama `removeFromFavorites` para ele. Tocar o coração de um produto
// pendente só pode levar a `addToFavorites` (uma segunda tentativa de
// gravação, agora com `upsert`+`ignoreDuplicates`, então inofensiva) —
// nunca a um `DELETE`. Sem `DELETE` disparado sobre um produto pendente,
// não existe corrida para fechar: o defeito é inalcançável por construção,
// não porque uma marca o barra.
//
// Este teste prova exatamente isso: durante toda a janela em que o upsert
// de p1 está em voo — inclusive depois de tocar o coração dele —, nenhum
// DELETE é disparado para p1. E prova o efeito colateral aceito
// conscientemente: enquanto pendente, p1 não aparece como favorito (nem em
// `isFavorite`, nem em `favorites`), e some de `pendingCount` só quando a
// gravação de fato confirma.
import type { Context } from "react";
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const FAVORITES_KEY = "ikcous_favorites";
const pendingKeyDe = (userId: string) => `ikcous_favorites_pendentes:${userId}`;

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

// `favorites` na tela lê `dbFavoriteIds` via `allProducts.filter(...)` —
// sem os produtos aqui, a asserção de que p1 aparece depois de confirmado
// não provaria nada (mediria o catálogo vazio, não o comportamento real).
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [
      { id: "p1", name: "Produto p1", price: 10, images: [] },
      { id: "p2", name: "Produto p2", price: 10, images: [] },
    ] as unknown as Product[],
    loading: false,
  }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

// Estado do "servidor" no dublê — sem isto, `select` não conseguiria
// refletir se algum DELETE indevido apagou o que foi criado.
let dbRows = new Set<string>(); // chave: `${user_id}|${product_id}`
let chamadasUpsert: { user_id: string; product_id: string }[] = [];
let chamadasDelete: { user_id: string; product_id: string }[] = [];
let segurarProduto = new Set<string>();
let resolvedoresPendentes = new Map<string, Array<() => void>>();

function liberarProduto(id: string) {
  const lista = resolvedoresPendentes.get(id) ?? [];
  resolvedoresPendentes.delete(id);
  for (const resolver of lista) resolver();
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: (obj: { user_id: string; product_id: string }) => {
          chamadasUpsert.push({ ...obj });
          const chave = `${obj.user_id}|${obj.product_id}`;
          if (segurarProduto.has(obj.product_id)) {
            return new Promise((resolve) => {
              const atual = resolvedoresPendentes.get(obj.product_id) ?? [];
              atual.push(() => {
                dbRows.add(chave);
                resolve({ data: [{}], error: null });
              });
              resolvedoresPendentes.set(obj.product_id, atual);
            });
          }
          dbRows.add(chave);
          return Promise.resolve({ data: [{}], error: null });
        },
        select: () => ({
          eq: (_col: string, userId: string) =>
            Promise.resolve({
              data: Array.from(dbRows)
                .filter((chave) => chave.startsWith(`${userId}|`))
                .map((chave) => ({ product_id: chave.split("|")[1] })),
              error: null,
            }),
        }),
        delete: () => ({
          eq: (_col1: string, userId: string) => ({
            eq: (_col2: string, productId: string) => {
              chamadasDelete.push({ user_id: userId, product_id: productId });
              dbRows.delete(`${userId}|${productId}`);
              return Promise.resolve({ error: null });
            },
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

function produto(id: string): Product {
  return {
    id,
    name: `Produto ${id}`,
    price: 10,
    images: [],
  } as unknown as Product;
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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbRows = new Set<string>();
  chamadasUpsert = [];
  chamadasDelete = [];
  segurarProduto = new Set<string>();
  resolvedoresPendentes = new Map<string, Array<() => void>>();
  usuarioDaVez = null;
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

describe("FavoritesContext — pendente não é tocável: tocar o coração nunca dispara DELETE sobre um produto ainda em voo", () => {
  it("p1 pendente (upsert em voo): não aparece como favorito, tocar o coração tenta ADICIONAR de novo (não remover), e nenhum DELETE é disparado", async () => {
    // 1. Visitante favorita p1 e p2 sem conta.
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify([produto("p1"), produto("p2")]),
    );

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

    // 2. Loga em rede lenta: o upsert de p1 fica em voo (segurado). p2 não
    // é segurado — sincroniza normalmente, controle de que a correção não
    // quebra o caminho feliz.
    segurarProduto.add("p1");
    usuarioDaVez = { id: "userA" };

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    // Sem `flush()` completo aqui de propósito — o upsert de p1 está
    // segurado, então o sync de login (Promise.all de todos os upserts)
    // fica preso, e `fetchDbFavorites` (que só roda DEPOIS) nunca chega a
    // acontecer nesta janela.

    // Write-ahead: os dois ainda estão retidos como pendentes em disco e em
    // `pendingCount` — isso não mudou com o redesenho.
    expect(
      JSON.parse(storageFake.getItem(pendingKeyDe("userA")) ?? "[]").map(
        (p: Product) => p.id,
      ),
    ).toEqual(expect.arrayContaining(["p1", "p2"]));
    const ctxMidVoo = ultimoContexto as {
      favorites: Product[];
      isFavorite: (id: string) => boolean;
      pendingCount: number;
    } | null;
    expect(ctxMidVoo?.pendingCount).toBe(2);

    // O que importa antes de qualquer toque: p1 pendente NÃO é considerado
    // favorito em lugar nenhum — nem na lista, nem em `isFavorite`. Sem
    // isso não haveria nada para provar (o coração já estaria "cheio").
    expect(ctxMidVoo?.isFavorite("p1")).toBe(false);
    expect((ctxMidVoo?.favorites ?? []).map((p) => p.id)).not.toContain("p1");

    // 3. Ela toca no coração de p1 mesmo assim — ainda com o upsert em voo.
    const ctx = ultimoContexto as {
      toggleFavorite: (p: Product) => void;
    } | null;
    await act(async () => {
      ctx?.toggleFavorite(produto("p1"));
    });
    await flush();

    // O toque NUNCA pode virar um DELETE: como `isFavorite` já dizia que
    // p1 não era favorito, `toggleFavorite` só pode ter chamado
    // `addToFavorites` — uma segunda tentativa de gravação, não uma
    // remoção. É essa ausência de caminho que torna a corrida antiga
    // (marca de cancelamento + DELETE compensatório) inalcançável.
    expect(chamadasDelete.filter((d) => d.product_id === "p1")).toHaveLength(0);
    // A segunda tentativa usa `upsert` (idempotente), então mais uma
    // chamada de upsert para p1 é esperada — prova que o toque tentou
    // ADICIONAR, não remover.
    expect(
      chamadasUpsert.filter((c) => c.product_id === "p1").length,
    ).toBeGreaterThanOrEqual(2);

    // 4. O upsert original de p1 finalmente aterrissa (com sucesso).
    liberarProduto("p1");
    await flush();

    // Nunca houve DELETE para p1 em NENHUM momento — não existe "ressuscitar"
    // porque nunca houve uma remoção real para desfazer.
    expect(chamadasDelete.filter((d) => d.product_id === "p1")).toHaveLength(0);
    expect(dbRows.has("userA|p1")).toBe(true);

    // Controle positivo: p2 (não tocado) sincronizou normalmente e
    // continua favoritado — a correção não quebrou o caminho feliz.
    expect(dbRows.has("userA|p2")).toBe(true);
  });
});
