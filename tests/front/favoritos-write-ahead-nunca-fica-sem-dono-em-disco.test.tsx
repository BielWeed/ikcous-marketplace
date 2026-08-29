// @vitest-environment jsdom
//
// Defeito 2 da revisão de contexto limpo (26/08/2026) sobre esta mesma
// correção: a MINHA instrução original ("a chave anônima muda de dono no
// login, SEMPRE") foi implementada ao pé da letra apagando o balde anônimo
// ANTES do `await` da gravação no servidor — e a fila por usuário só era
// escrita DEPOIS que a rede respondia. Entre os dois instantes, os
// favoritos existiam SÓ NA MEMÓRIA do React: se a aba morresse nessa
// janela (fechar, recarregar, o navegador matando a aba, ou o próprio
// GlobalErrorBoundary chamando `window.location.reload()`), os favoritos
// somiam para sempre — uma perda que o código ORIGINAL (antes de qualquer
// correção deste lote) não tinha, porque o balde anônimo segurava os dois
// durante toda a janela.
//
// A correção é WRITE-AHEAD: grava a fila do usuário ANTES de tocar no
// balde anônimo e antes de qualquer tentativa de rede. Este teste prova
// que, durante TODA a janela — inclusive com o upsert pendurado (rede
// LENTA, não caída, o cenário real) — o disco nunca fica sem os
// favoritos: read direto do localStorage, no meio do voo, tem que
// devolver os dois produtos.
//
// Vermelho contra o código antigo: no meio do voo (upsert pendurado, antes
// de resolver), a fila em disco está vazia — só a gravação ao FINAL do
// `tentarSincronizarComServidor` (depois do `await Promise.all`) escrevia
// alguma coisa lá.
import { act } from "react";
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
  useProducts: () => ({ products: [] as Product[], loading: false }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

// Todo upsert desta suíte fica PENDURADO até o teste chamar `liberarTodos`
// — simula rede LENTA (não caída), a janela onde o defeito 2 vivia.
let resolvedoresPendentes: Array<() => void> = [];
function liberarTodos() {
  const lista = resolvedoresPendentes;
  resolvedoresPendentes = [];
  for (const resolver of lista) resolver();
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: () =>
          new Promise((resolve) => {
            resolvedoresPendentes.push(() =>
              resolve({ data: [{}], error: null }),
            );
          }),
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
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

function idsDaFilaEmDisco(
  storage: ReturnType<typeof criarStorageFake>,
  userId: string,
): string[] {
  const raw = storage.getItem(pendingKeyDe(userId));
  if (!raw) return [];
  return (JSON.parse(raw) as Product[]).map((p) => p.id).sort();
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
  resolvedoresPendentes = [];
  usuarioDaVez = null;
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
  liberarTodos();
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("FavoritesContext — write-ahead: a fila por usuário nunca fica ausente do disco", () => {
  it("com o upsert pendurado (rede lenta), o disco já tem os dois favoritos ANTES da rede responder", async () => {
    // 1. Visitante favorita 2 produtos sem conta.
    storageFake.setItem(
      FAVORITES_KEY,
      JSON.stringify([produto("p1"), produto("p2")]),
    );

    const { FavoritesProvider } = await import("@/contexts/FavoritesContext");

    await act(async () => {
      raiz.render(<FavoritesProvider>{null}</FavoritesProvider>);
    });
    await flush();

    // 2. Loga — o upsert dos dois fica PENDURADO (rede lenta).
    usuarioDaVez = { id: "userA" };

    await act(async () => {
      raiz.render(<FavoritesProvider>{null}</FavoritesProvider>);
    });
    // SEM flush() completo — é exatamente esta janela (sync em voo, rede
    // ainda não respondeu) que o defeito 2 explorava.

    // No MEIO do voo: o disco já tem os dois produtos na fila do usuário —
    // nunca ficou um instante sem dono. É a asserção que reprova contra o
    // código antigo (lá, esta chave estaria ausente/null aqui).
    expect(idsDaFilaEmDisco(storageFake, "userA")).toEqual(["p1", "p2"]);

    // E o balde anônimo já foi esvaziado (a chave muda de dono, sempre) —
    // sem isso o teste não estaria provando write-ahead, só que nada mudou.
    const anonimoNoMeioDoVoo = storageFake.getItem(FAVORITES_KEY);
    const idsAnonimos = anonimoNoMeioDoVoo
      ? (JSON.parse(anonimoNoMeioDoVoo) as Product[]).map((p) => p.id)
      : [];
    expect(idsAnonimos).toEqual([]);

    // 3. A rede responde — libera os upserts e deixa o sync terminar.
    liberarTodos();
    await flush();

    // Com sucesso, a fila esvazia (nada mais pendente) — o disco continua
    // consistente depois, não só durante o voo.
    expect(idsDaFilaEmDisco(storageFake, "userA")).toEqual([]);
  });
});
