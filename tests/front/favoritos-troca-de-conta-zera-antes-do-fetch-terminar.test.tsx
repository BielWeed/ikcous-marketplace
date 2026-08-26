// @vitest-environment jsdom
//
// A guarda que a revisão de contexto limpo (26/08/2026) encontrou "morta
// por mutação": `if (trocouDeConta) { setDbFavoriteIds([]); setPendingFavorites([]); }`,
// em `FavoritesContext.tsx`, roda ANTES de qualquer `await` do efeito de
// sync — zera o estado do usuário anterior no INSTANTE em que a troca de
// conta (AuthContext.tsx:579-583, `isCriticalTransition`, sem passar por
// `null`) é detectada. A revisão removeu a guarda inteira e 9 de 9 testes
// já existentes continuaram verdes — porque nenhum deles observa a JANELA
// entre a troca e o fetch assíncrono terminar: todos usam `flush()`
// completo antes de checar qualquer coisa, e por aí o fetch (mesmo sem a
// guarda) já tinha corrigido `dbFavoriteIds` sozinho.
//
// Este teste observa exatamente essa janela: segura a resposta do `select`
// de B (a chamada de rede que `fetchDbFavorites` faz) e espia o contexto
// ANTES dela resolver — o único jeito de a guarda ter algum efeito
// observável.
//
// Vermelho contra o código sem a guarda: sem `setDbFavoriteIds([])` no
// instante da troca, `favorites` continua mostrando o produto de A até o
// `select` de B (que estamos segurando) resolver — a asserção do passo 3
// reprovaria.
import type { Context } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { useContext, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const pendingKeyDe = (userId: string) => `ikcous_favorites_pendentes:${userId}`;

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [{ id: "pA", name: "Produto de A", price: 10, images: [] }] as unknown as Product[],
    loading: false,
  }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

let dbRows = new Set<string>(); // chave: `${user_id}|${product_id}`
let segurarSelectParaUsuario = new Set<string>();
let resolvedorSelectPresoDeB: (() => void) | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: (obj: { user_id: string; product_id: string }) => {
          // "pAP" nunca sincroniza — fica preso na fila de A de propósito,
          // para o controle do passo 1 (pendingCount > 0) valer algo.
          if (obj.product_id === "pAP") {
            return Promise.resolve({
              data: null,
              error: { message: "rede caiu" },
            });
          }
          dbRows.add(`${obj.user_id}|${obj.product_id}`);
          return Promise.resolve({ data: [{}], error: null });
        },
        select: () => ({
          eq: (_col: string, userId: string) => {
            if (segurarSelectParaUsuario.has(userId)) {
              return new Promise((resolve) => {
                resolvedorSelectPresoDeB = () =>
                  resolve({
                    data: Array.from(dbRows)
                      .filter((chave) => chave.startsWith(`${userId}|`))
                      .map((chave) => ({ product_id: chave.split("|")[1] })),
                    error: null,
                  });
              });
            }
            return Promise.resolve({
              data: Array.from(dbRows)
                .filter((chave) => chave.startsWith(`${userId}|`))
                .map((chave) => ({ product_id: chave.split("|")[1] })),
              error: null,
            });
          },
        }),
        delete: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: null }),
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
  segurarSelectParaUsuario = new Set<string>();
  resolvedorSelectPresoDeB = null;
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

describe("FavoritesContext — a troca de conta A->B zera dbFavoriteIds/pendingFavorites antes do fetch de B terminar", () => {
  it("B não pode ver o favorito de A nem o pendingCount de A durante a janela em que o próprio fetch de B ainda está em voo", async () => {
    // 1. A loga, favorita pA com sucesso, e também deixa uma pendência
    // presa (rede falhando para um segundo item hipotético) — usamos a
    // própria chave de pendentes de A para simular isso diretamente em
    // disco, sem depender de um segundo produto no catálogo.
    usuarioDaVez = { id: "userA" };
    dbRows.add("userA|pA");
    storageFake.setItem(
      pendingKeyDe("userA"),
      JSON.stringify([{ id: "pAP", name: "Pendente de A", price: 5, images: [] }]),
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

    let ctx = ultimoContexto as {
      favorites: Product[];
      pendingCount: number;
    };
    // Controle: A de fato está com pA confirmado e pAP pendente antes da
    // troca — sem isto não haveria nada de A para vazar para B.
    expect(ctx.favorites.map((p) => p.id)).toContain("pA");
    expect(ctx.pendingCount).toBeGreaterThan(0);

    // 2. Troca DIRETA para B, sem logout — a mesma transição crítica que
    // AuthContext.tsx faz sem passar por `null` quando o id muda. Segura o
    // `select` de B (a chamada de `fetchDbFavorites`) para poder espiar o
    // estado ANTES dela resolver.
    segurarSelectParaUsuario.add("userB");
    usuarioDaVez = { id: "userB" };

    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    // Sem `flush()` completo de propósito: o `select` de B está preso, e é
    // exatamente essa janela — depois da troca ser detectada, antes do
    // fetch de B terminar — que a guarda protege.

    expect(resolvedorSelectPresoDeB).not.toBeNull();

    // 3. O que decide o teste: NESTA janela, `favorites` não pode conter
    // pA (o produto de A), e `pendingCount` não pode carregar o valor de A.
    ctx = ultimoContexto as typeof ctx;
    expect(ctx.favorites.map((p) => p.id)).not.toContain("pA");
    expect(ctx.pendingCount).toBe(0);

    // 4. Libera o `select` de B para não deixar promessa pendurada — B não
    // tem nada no servidor, então o fetch confirma vazio mesmo.
    resolvedorSelectPresoDeB?.();
    await flush();

    ctx = ultimoContexto as typeof ctx;
    expect(ctx.favorites.map((p) => p.id)).not.toContain("pA");
  });
});
