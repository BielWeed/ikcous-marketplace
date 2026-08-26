// @vitest-environment jsdom
//
// O defeito (26/08/2026) desta rodada, sobre a mesma correção do vazamento
// de favoritos entre contas: a fila pendente (`ikcous_favorites_pendentes:
// <userId>`) só sabia ENTRAR. `addToFavorites` e `removeFromFavorites`
// nunca a tocavam — então um favorito que confirmava (ou era removido) por
// um desses dois caminhos, fora da retentativa, ficava "esquecido" em
// disco. A próxima retentativa (evento `online`, ou simplesmente montar o
// Provider de novo — o efeito de sync lê a fila em TODA montagem, inclusive
// um F5) o ressuscitava, mesmo depois de a pessoa ter removido de
// propósito.
//
// Este teste reproduz o cenário exato de cinco passos que abriu a tarefa:
// 1. Visitante favorita p1 sem conta. Loga; o servidor recusa (disco: [p1],
//    servidor: vazio).
// 2. A rede volta. Ela toca o coração (vazio, por design — pendente não
//    aparece como favorito) e `addToFavorites` grava com sucesso.
// 3. Ela muda de ideia e remove p1: `removeFromFavorites` grava a remoção.
// 4. O celular oscila (`online` dispara) — a retentativa lê a fila do
//    disco.
// 5. p1 NÃO pode estar de volta no servidor — nem por causa do evento
//    `online`, nem por causa de um F5 (remontagem do Provider, que lê a
//    fila na inicialização do efeito de sync).
//
// Vermelho contra o código antigo: sem a retirada pontual em
// `addToFavorites`/`removeFromFavorites`, a fila em disco continua com
// `[p1]` do passo 1 até o fim — o passo 4 (e o 5) reenviam um upsert para
// p1 e ele reaparece em `dbRows`, mesmo depois do DELETE explícito do
// passo 3.
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
// O PRIMEIRO upsert de p1 (o do login) sempre falha — simula "o servidor
// recusa" do passo 1. Os seguintes sucedem, salvo controle explícito.
let primeiroUpsertFalha = true;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: (obj: { user_id: string; product_id: string }) => {
          chamadasUpsert.push({ ...obj });
          if (primeiroUpsertFalha) {
            primeiroUpsertFalha = false;
            return Promise.resolve({
              data: null,
              error: { message: "servidor recusou" },
            });
          }
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
  primeiroUpsertFalha = true;
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

describe("FavoritesContext — item confirmado ou removido explicitamente sai da fila pendente, e não volta", () => {
  it("os 5 passos: favorita sem conta, login recusa, toque adiciona, ela remove, online e F5 não trazem p1 de volta", async () => {
    // 1. Visitante favorita p1 sem conta, loga, e o servidor recusa a
    // gravação (primeiro upsert falha).
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

    expect(dbRows.has("userA|p1")).toBe(false);
    expect(
      JSON.parse(storageFake.getItem(pendingKeyDe("userA")) ?? "[]").map(
        (p: Product) => p.id,
      ),
    ).toEqual(["p1"]);
    let ctx = ultimoContexto as {
      isFavorite: (id: string) => boolean;
      pendingCount: number;
      toggleFavorite: (p: Product) => void;
    };
    expect(ctx.pendingCount).toBe(1);
    expect(ctx.isFavorite("p1")).toBe(false);

    // 2. A rede volta. Ela toca o coração (vazio) — `addToFavorites` grava
    // com sucesso desta vez.
    await act(async () => {
      ctx.toggleFavorite(produto("p1"));
    });
    await flush();

    expect(dbRows.has("userA|p1")).toBe(true);
    // O que este teste prende: a fila em disco não pode continuar com p1
    // depois que a gravação confirmou — sem a retirada em `addToFavorites`,
    // esta linha reprovaria.
    expect(
      JSON.parse(storageFake.getItem(pendingKeyDe("userA")) ?? "[]"),
    ).toEqual([]);
    ctx = ultimoContexto as typeof ctx;
    expect(ctx.pendingCount).toBe(0);

    // 3. Ela muda de ideia e remove p1.
    await act(async () => {
      ctx.toggleFavorite(produto("p1"));
    });
    await flush();

    expect(dbRows.has("userA|p1")).toBe(false);
    expect(
      JSON.parse(storageFake.getItem(pendingKeyDe("userA")) ?? "[]"),
    ).toEqual([]);

    const chamadasAntesDaRetentativa = chamadasUpsert.length;

    // 4. O celular oscila — dispara `online`. A retentativa lê a fila do
    // disco (vazia) e não deve reenviar NADA para p1.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();

    expect(dbRows.has("userA|p1")).toBe(false);
    expect(
      chamadasUpsert
        .slice(chamadasAntesDaRetentativa)
        .filter((c) => c.product_id === "p1"),
    ).toHaveLength(0);

    // 5. Um F5 — remonta o Provider do zero com o mesmo usuário logado. O
    // efeito de sync lê a fila pendente NA INICIALIZAÇÃO; se ela ainda
    // tivesse p1, este remount reenviaria o upsert.
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    const chamadasAntesDoReload = chamadasUpsert.length;

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    await flush();

    expect(dbRows.has("userA|p1")).toBe(false);
    expect(
      chamadasUpsert
        .slice(chamadasAntesDoReload)
        .filter((c) => c.product_id === "p1"),
    ).toHaveLength(0);

    ctx = ultimoContexto as typeof ctx;
    expect(ctx.pendingCount).toBe(0);
    expect(ctx.isFavorite("p1")).toBe(false);
  });
});
