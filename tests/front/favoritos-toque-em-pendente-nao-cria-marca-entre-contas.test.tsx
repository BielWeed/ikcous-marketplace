// @vitest-environment jsdom
//
// Redesenho subtrativo (26/08/2026) sobre a correção do vazamento de
// favoritos entre contas — `FavoritesContext.tsx`.
//
// Defeito 1 do lote (rodada 4): a marca de cancelamento (`canceladosRef`,
// removida) era um `Set<productId>` só — sem o `userId` — vivo pelo tempo
// de vida do Provider inteiro, nunca esvaziado na troca de conta. Se a
// pessoa A tocasse o coração de um produto p1 AINDA pendente (marcando
// "cancelado") enquanto o upsert dela para p1 estava em voo, e — antes
// desse upsert resolver — outra conta B, no MESMO aparelho, sincronizasse
// com sucesso o MESMO product_id p1 (coincidência de catálogo, não de
// dono: B só favoritou o mesmo produto, em outro momento, em outro
// aparelho), o sucesso do upsert de B também consumia a marca deixada por
// A — e disparava um DELETE usando o `userId` de B, apagando o favorito de
// B por uma ação que nunca foi dele.
//
// Esse mecanismo saiu inteiro do código. Este teste reproduz o cenário que
// o alimentava — A tenta "cancelar" p1 pendente, depois B (sem logout de
// A) sincroniza o mesmo product_id com sucesso — e prova que NENHUM DELETE
// é disparado para B: não porque uma marca por usuário o impede, mas
// porque não existe mais marca nenhuma, de espécie alguma, para consumir.
import type { Context } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { useContext, useEffect } from "react";
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

// Estado do "servidor" no dublê — chave `${user_id}|${product_id}`, para
// que cada conta tenha sua PRÓPRIA linha mesmo compartilhando o mesmo
// product_id.
let dbRows = new Set<string>();
let chamadasDelete: { user_id: string; product_id: string }[] = [];
// Segura QUALQUER upsert para este product_id, de QUALQUER usuário — é a
// forma mais direta de simular "a rede está lenta para escrever este
// produto agora", o cenário que deixava as duas contas com upserts em voo
// ao mesmo tempo.
let segurarProduto = new Set<string>();
let resolvedoresPendentes: Array<() => void> = [];

function liberarTodosOsUpsertsSegurados() {
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
        upsert: (obj: { user_id: string; product_id: string }) => {
          const chave = `${obj.user_id}|${obj.product_id}`;
          if (segurarProduto.has(obj.product_id)) {
            return new Promise((resolve) => {
              resolvedoresPendentes.push(() => {
                dbRows.add(chave);
                resolve({ data: [{}], error: null });
              });
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
  chamadasDelete = [];
  segurarProduto = new Set<string>();
  resolvedoresPendentes = [];
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
  liberarTodosOsUpsertsSegurados();
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("FavoritesContext — tocar um pendente não planta marca nenhuma que sobreviva à troca de conta", () => {
  it("A tenta cancelar p1 pendente (upsert em voo); B loga direto e sincroniza o MESMO product_id com sucesso — nenhum DELETE atinge B", async () => {
    segurarProduto.add("p1");

    // 1. A favorita p1 sem conta.
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

    // 2. A loga — o upsert de p1 fica em voo (segurado).
    usuarioDaVez = { id: "userA" };
    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    // Sem flush completo: o sync de A fica preso no upsert segurado.

    // 3. A tenta "cancelar" p1 tocando o coração — como p1 é pendente,
    // `isFavorite` já diz que não é favorito, então isto só pode disparar
    // uma NOVA tentativa de adicionar (idempotente), nunca um DELETE.
    const ctxDeA = ultimoContexto as {
      toggleFavorite: (p: Product) => void;
    } | null;
    await act(async () => {
      ctxDeA?.toggleFavorite(produto("p1"));
    });
    // Ainda sem flush completo — o(s) upsert(s) de p1 continuam presos.

    expect(chamadasDelete.filter((d) => d.product_id === "p1")).toHaveLength(
      0,
    );

    // 4. B loga DIRETO, sem A passar por logout — a mesma transição crítica
    // que AuthContext.tsx faz sem passar por `null` quando o id muda. B já
    // tinha o MESMO product_id p1 favoritado antes (outro aparelho, por
    // exemplo), pendente de sincronizar agora.
    storageFake.setItem(pendingKeyDe("userB"), JSON.stringify([produto("p1")]));
    usuarioDaVez = { id: "userB" };
    await act(async () => {
      raiz.render(
        <FavoritesProvider>
          <Sonda contexto={FavoritesContext} />
        </FavoritesProvider>,
      );
    });
    // O upsert de B para p1 também fica preso (mesmo product_id segurado).

    // 5. A rede libera TODOS os upserts presos de p1 — o de A (original), o
    // de A (retentativa do toque) e o de B, na ordem em que foram
    // disparados.
    liberarTodosOsUpsertsSegurados();
    await flush();

    // O que importa: nenhum DELETE jamais atingiu B. No código antigo, o
    // sucesso do upsert de B consumiria a marca deixada por A (mesmo
    // product_id, sem checar dono) e apagaria a própria linha de B.
    expect(
      chamadasDelete.filter((d) => d.user_id === "userB"),
    ).toHaveLength(0);
    expect(dbRows.has("userB|p1")).toBe(true);

    // E o favorito de A também não foi apagado por engano.
    expect(
      chamadasDelete.filter((d) => d.user_id === "userA"),
    ).toHaveLength(0);
    expect(dbRows.has("userA|p1")).toBe(true);
  });
});
