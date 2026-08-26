// @vitest-environment jsdom
//
// A armadilha (26/08/2026) que matou as rodadas 2 a 4 da correção do
// vazamento de favoritos entre contas: `tentarSincronizarComServidor`
// sobrescrevia o disco às cegas — `gravarFavoritosPendentes(userId,
// naoSincronizados)` — a partir de um retrato calculado ANTES do `await
// Promise.all` dos upserts, sem reler o disco.
//
// Este teste prende exatamente a corrida que essa sobrescrita causava: uma
// retentativa (evento `online`) que fica presa em voo (rede lenta, não
// caída) e SÓ TERMINA — e com ERRO — DEPOIS que um caminho diferente (um
// segundo toque manual, bem-sucedido) já retirou o mesmo produto da fila.
// Quando a retentativa presa finalmente resolve, ela não pode reescrever a
// fila com o produto de volta: quem estava lá quando ela terminou (fila já
// vazia, por causa da retirada concorrente) tem que continuar valendo.
//
// Vermelho contra o código antigo: a versão anterior de
// `tentarSincronizarComServidor` grava `naoSincronizados` (calculado a
// partir do retrato ANTES do await) direto por cima do disco, sem reler —
// isso repõe o produto na fila mesmo ele já tendo sido retirado por outro
// caminho enquanto a retentativa estava presa.
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

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [
      { id: "p1", name: "Produto p1", price: 10, images: [] },
    ] as unknown as Product[],
    loading: false,
  }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

// Estado do "servidor" no dublê.
let dbRows = new Set<string>(); // chave: `${user_id}|${product_id}`
let chamadasUpsert: { user_id: string; product_id: string }[] = [];
// Contador de chamadas de upsert POR PRODUTO — a 1ª chamada para "p1" (a do
// login) falha rápido; a 2ª (a da retentativa presa em voo) fica pendurada
// até `liberarRetentativaPresa()`, e quando libera, FALHA; a 3ª em diante
// (o toque manual) sucede na hora.
let chamadaPorProduto: Record<string, number> = {};
let resolverRetentativaPresa: (() => void) | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: (obj: { user_id: string; product_id: string }) => {
          chamadasUpsert.push({ ...obj });
          const n = (chamadaPorProduto[obj.product_id] ?? 0) + 1;
          chamadaPorProduto[obj.product_id] = n;

          if (obj.product_id === "p1" && n === 1) {
            // 1ª chamada (login): falha na hora — "o servidor recusa".
            return Promise.resolve({
              data: null,
              error: { message: "servidor recusou" },
            });
          }
          if (obj.product_id === "p1" && n === 2) {
            // 2ª chamada (a retentativa via `online`): fica presa em voo.
            return new Promise((resolve) => {
              resolverRetentativaPresa = () =>
                resolve({
                  data: null,
                  error: { message: "ainda sem rede" },
                });
            });
          }
          // 3ª chamada em diante (o toque manual): sucede na hora.
          dbRows.add(`${obj.user_id}|${obj.product_id}`);
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
  chamadaPorProduto = {};
  resolverRetentativaPresa = null;
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

describe("FavoritesContext — a corrida: retirada concorrente sobrevive a uma drenagem que resolve depois, e com erro", () => {
  it("retentativa presa em voo, produto retirado por um toque manual enquanto ela espera, e ao resolver (com erro) não repõe o produto na fila", async () => {
    // 1. Visitante favorita p1, loga, e o servidor recusa (1ª chamada).
    storageFake.setItem(FAVORITES_KEY, JSON.stringify([produto("p1")]));

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

    usuarioDaVez = { id: "userA" };
    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    expect(
      JSON.parse(storageFake.getItem(pendingKeyDe("userA")) ?? "[]").map(
        (p: Product) => p.id,
      ),
    ).toEqual(["p1"]);

    // 2. Dispara a retentativa (`online`) — a 2ª chamada de upsert para p1
    // fica presa em voo (rede lenta, não caída).
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();

    // Controle: a retentativa de fato começou (2ª chamada registrada) e
    // está presa — ainda não resolveu.
    expect(chamadasUpsert.filter((c) => c.product_id === "p1")).toHaveLength(2);
    expect(resolverRetentativaPresa).not.toBeNull();

    // 3. ENQUANTO ela está presa, um toque manual (3ª chamada) sincroniza
    // p1 com sucesso — e RETIRA p1 da fila.
    const ctxAntes = ultimoContexto as { toggleFavorite: (p: Product) => void };
    await act(async () => {
      ctxAntes.toggleFavorite(produto("p1"));
    });
    await flush();

    expect(dbRows.has("userA|p1")).toBe(true);
    expect(
      JSON.parse(storageFake.getItem(pendingKeyDe("userA")) ?? "[]"),
    ).toEqual([]);
    let ctx = ultimoContexto as { pendingCount: number };
    expect(ctx.pendingCount).toBe(0);

    // 4. AGORA a retentativa presa finalmente resolve — e com ERRO (ainda
    // sem rede, do ponto de vista DELA). O que decide o teste: a fila não
    // pode voltar a ter p1 por causa dessa resolução tardia.
    resolverRetentativaPresa?.();
    await flush();

    expect(
      JSON.parse(storageFake.getItem(pendingKeyDe("userA")) ?? "[]"),
    ).toEqual([]);
    ctx = ultimoContexto as { pendingCount: number };
    expect(ctx.pendingCount).toBe(0);
    // E o favorito continua confirmado — a resolução tardia não desfez o
    // que o toque manual já tinha feito.
    expect(dbRows.has("userA|p1")).toBe(true);
  });
});
