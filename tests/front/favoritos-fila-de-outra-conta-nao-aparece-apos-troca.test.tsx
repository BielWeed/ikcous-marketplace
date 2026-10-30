// @vitest-environment jsdom
//
// Issue #647, parte que ainda procedia: `tentarSincronizarComServidor` termina
// o `await Promise.all(upserts)` e grava `restante` (a fila de DISCO da conta
// que disparou a drenagem) no estado VISIVEL (`setPendingFavorites`) sem
// conferir se a conta ainda e a mesma. Numa troca DIRETA A->B (o Provider nao
// desmonta; AuthContext.tsx:579-583, `isCriticalTransition`) com o upsert de A
// ainda em voo, a fila de A aparecia em `pendingCount` de B — e, no caminho
// de sucesso, a lista vazia de A apagava a contagem PROPRIA de B.
//
// A ordem das promessas e controlada a mao: o upsert de A fica retido, a troca
// acontece, e so no fim ele e resolvido. Nada depende de tempo real.
//
// A fila EM DISCO de A continua sendo da conta que gravou: sincronizou -> sai
// da fila; falhou -> continua la para a proxima retentativa dela.
import type { Context } from "react";
import { act } from "react";
import { useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
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
    products: [
      { id: "pAP", name: "Pendente de A", price: 5, images: [] },
      { id: "pB", name: "Pendente de B", price: 7, images: [] },
    ] as unknown as Product[],
    loading: false,
  }),
}));

let usuarioDaVez: { id: string } | null = null;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioDaVez }),
}));

// Upsert de `pAP` fica retido ate `liberarUpsertDeA` — resolve com o `erro`
// escolhido pelo teste (`null` = o servidor aceitou).
let chamadasUpsert: { user_id: string; product_id: string }[] = [];
let liberarUpsertDeA: ((erro: { message: string } | null) => void) | null =
  null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "favorites") {
        throw new Error(`tabela inesperada no dublê: ${tabela}`);
      }
      return {
        upsert: (obj: { user_id: string; product_id: string }) => {
          chamadasUpsert.push({ ...obj });
          if (obj.user_id === "userA" && obj.product_id === "pAP") {
            return new Promise((resolve) => {
              liberarUpsertDeA = (erro) =>
                resolve({ data: erro ? null : [{}], error: erro });
            });
          }
          // O pendente de B nunca sincroniza: fica na fila de B de proposito,
          // para o controle de `pendingCount` de B valer algo.
          if (obj.product_id === "pB") {
            return Promise.resolve({
              data: null,
              error: { message: "rede caiu" },
            });
          }
          return Promise.resolve({ data: [{}], error: null });
        },
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
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
// testes irmaos de FavoritesContext.
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

type Ctx = {
  favorites: Product[];
  pendingCount: number;
  isFavorite: (id: string) => boolean;
};

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
  chamadasUpsert = [];
  liberarUpsertDeA = null;
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

// A loga com `pAP` pendente e a drenagem (upsert) retida; troca DIRETA para B;
// devolve o contexto de B ja com a troca assentada e o upsert de A ainda preso.
async function logarEmAcomUpsertRetidoETrocarParaB(filaDeB: Product[]) {
  storageFake.setItem(pendingKeyDe("userA"), JSON.stringify([produto("pAP")]));
  if (filaDeB.length > 0) {
    storageFake.setItem(pendingKeyDe("userB"), JSON.stringify(filaDeB));
  }

  const { FavoritesProvider, FavoritesContext } = await import(
    "@/contexts/FavoritesContext"
  );
  const montar = () => (
    <FavoritesProvider>
      <Sonda contexto={FavoritesContext} />
    </FavoritesProvider>
  );

  usuarioDaVez = { id: "userA" };
  await act(async () => {
    raiz.render(montar());
  });
  // Sem `flush()` completo: o upsert de A esta retido de proposito.

  // Controle: a drenagem de A de fato esta em voo e A ve a propria fila.
  expect(liberarUpsertDeA).not.toBeNull();
  expect(chamadasUpsert).toContainEqual({
    user_id: "userA",
    product_id: "pAP",
  });
  expect((ultimoContexto as Ctx).pendingCount).toBe(1);

  usuarioDaVez = { id: "userB" };
  await act(async () => {
    raiz.render(montar());
  });
  await flush();

  return ultimoContexto as Ctx;
}

describe("FavoritesContext — a fila de A que termina de drenar depois da troca direta A->B", () => {
  it("falha do upsert de A: B nao ve o pendente de A (contagem, lista, isFavorite) e a fila em disco de A continua com ele", async () => {
    const ctxDeB = await logarEmAcomUpsertRetidoETrocarParaB([]);

    // Antes de A terminar: B limpo.
    expect(ctxDeB.pendingCount).toBe(0);

    // O upsert de A termina por ULTIMO — e falha.
    await act(async () => {
      liberarUpsertDeA?.({ message: "rede caiu" });
    });
    await flush();

    const depois = ultimoContexto as Ctx;
    expect(depois.pendingCount).toBe(0);
    expect(depois.favorites.map((p) => p.id)).not.toContain("pAP");
    expect(depois.isFavorite("pAP")).toBe(false);

    // A fila em disco e da conta que gravou: A nao perde a pendencia, e B
    // nao ganha nada em disco.
    const filaDeA = JSON.parse(
      storageFake.getItem(pendingKeyDe("userA")) ?? "[]",
    ) as Product[];
    expect(filaDeA.map((p) => p.id)).toEqual(["pAP"]);
    expect(storageFake.getItem(pendingKeyDe("userB"))).toBeNull();
  });

  it("sucesso do upsert de A: a contagem PROPRIA de B nao e zerada e o pendente de A sai da fila em disco de A", async () => {
    const ctxDeB = await logarEmAcomUpsertRetidoETrocarParaB([produto("pB")]);

    // Controle: B tem 1 pendente proprio (o upsert de pB falha na hora).
    expect(ctxDeB.pendingCount).toBe(1);

    // O upsert de A termina por ULTIMO — e o servidor aceita.
    await act(async () => {
      liberarUpsertDeA?.(null);
    });
    await flush();

    const depois = ultimoContexto as Ctx;
    expect(depois.pendingCount).toBe(1);
    expect(depois.favorites.map((p) => p.id)).not.toContain("pAP");

    // Sincronizou => saiu da fila de A; a fila de B segue intacta.
    expect(storageFake.getItem(pendingKeyDe("userA"))).toBeNull();
    const filaDeB = JSON.parse(
      storageFake.getItem(pendingKeyDe("userB")) ?? "[]",
    ) as Product[];
    expect(filaDeB.map((p) => p.id)).toEqual(["pB"]);
  });
});
