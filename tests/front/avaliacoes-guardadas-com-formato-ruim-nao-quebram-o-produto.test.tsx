// @vitest-environment jsdom
//
// O cache de avaliações por produto (`ikcous_reviews_cache_<produto>`) fica no
// aparelho e é PRESERVADO pela recuperação do app ("Recarregar" mantém o
// prefixo `ikcous_`). `getReviewsCache` devolvia o que o `JSON.parse` achasse:
// com `{}`, `"x"`, `123` ou `[null]` guardados, `reviews.filter` (ProductView)
// lançava e a página do produto caía, de novo a cada abertura.
//
// Agora um cache que não é lista de avaliações vale como "sem cache": devolve
// `null`, apaga a chave ruim e o hook segue com lista vazia e a rede.
//
// Dublê do BroadcastChannel: jsdom não tem, e o módulo do hook instancia um
// no topo do arquivo na importação.
vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    class BroadcastChannelFalso {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
      BroadcastChannelFalso;
  }
});

vi.mock("@/lib/supabase", () => {
  // Consulta que nunca responde: o teste olha só o que aparece ANTES da rede.
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => Promise.resolve({ data: [], error: null }),
    order: () => new Promise(() => {}),
  };
  return {
    supabase: { from: () => builder, rpc: () => new Promise(() => {}) },
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";
import {
  esvaziarAvaliacoesEmMemoria,
  getReviewsCache,
  updateReviewsCache,
} from "@/lib/cache-de-avaliacoes";
import type { Review } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function criarLocalStorageFake() {
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

const PRODUTO = "prod-bolsa";
const CHAVE = `ikcous_reviews_cache_${PRODUTO}`;

const AVALIACAO = {
  id: "rev-1",
  productId: PRODUTO,
  customerName: "Maria",
  rating: 5,
  comment: "linda",
  date: "2026-08-21T09:30:00.000Z",
  helpful: 0,
  verified: true,
  status: "publicada",
} as unknown as Review;

const FORMATOS_RUINS: [string, unknown][] = [
  ["objeto vazio", {}],
  ["texto", "x"],
  ["número", 123],
  ["null", null],
  ["null dentro da lista", [null]],
  ["número dentro da lista", [1, AVALIACAO]],
];

describe("avaliações guardadas com formato ruim não quebram a página do produto", () => {
  let storage: ReturnType<typeof criarLocalStorageFake>;

  beforeEach(() => {
    storage = criarLocalStorageFake();
    vi.stubGlobal("localStorage", storage);
    esvaziarAvaliacoesEmMemoria();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(FORMATOS_RUINS)(
    "%s: getReviewsCache devolve null e apaga a chave ruim",
    (_nome, guardado) => {
      storage.setItem(CHAVE, JSON.stringify(guardado));

      expect(getReviewsCache(PRODUTO)).toBeNull();
      expect(storage.getItem(CHAVE)).toBeNull();
      // Nem a memória guarda o lixo: a segunda leitura também é "sem cache".
      expect(getReviewsCache(PRODUTO)).toBeNull();
    },
  );

  it("lista válida continua voltando igual", () => {
    storage.setItem(CHAVE, JSON.stringify([AVALIACAO]));

    expect(getReviewsCache(PRODUTO)).toEqual([AVALIACAO]);
    expect(storage.getItem(CHAVE)).not.toBeNull();
  });

  it("lista vazia é cache válido (produto sem avaliações)", () => {
    storage.setItem(CHAVE, "[]");

    expect(getReviewsCache(PRODUTO)).toEqual([]);
  });

  it("o que o próprio app gravou volta igual", () => {
    updateReviewsCache(PRODUTO, [AVALIACAO]);
    // Só a memória é esvaziada: a segunda leitura vem do disco.
    esvaziarAvaliacoesEmMemoria();

    expect(getReviewsCache(PRODUTO)).toEqual([AVALIACAO]);
  });

  describe("hook useReviews (o que a página do produto lê)", () => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;

    beforeEach(() => {
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    });

    afterEach(() => {
      act(() => {
        raiz.unmount();
      });
      hospedeiro.remove();
    });

    type Ultimo = {
      reviews: Review[];
      getReviewsByProduct: (id: string) => Promise<void>;
    };

    async function abrirProduto(): Promise<Ultimo | undefined> {
      let ultimo: Ultimo | undefined;
      function Sonda() {
        const { reviews, getReviewsByProduct } = useReviews();
        useEffect(() => {
          ultimo = { reviews, getReviewsByProduct };
        });
        return null;
      }
      await act(async () => {
        raiz.render(<Sonda />);
      });
      await act(async () => {
        void ultimo?.getReviewsByProduct(PRODUTO);
      });
      return ultimo;
    }

    it.each(FORMATOS_RUINS)(
      "%s: `reviews` segue sendo lista e `.filter` não lança",
      async (_nome, guardado) => {
        storage.setItem(CHAVE, JSON.stringify(guardado));

        const ultimo = await abrirProduto();

        expect(Array.isArray(ultimo?.reviews)).toBe(true);
        expect(() =>
          ultimo?.reviews.filter((r) => r.status === "publicada"),
        ).not.toThrow();
        expect(ultimo?.reviews).toEqual([]);
      },
    );

    it("lista válida aparece antes de a rede responder", async () => {
      storage.setItem(CHAVE, JSON.stringify([AVALIACAO]));

      const ultimo = await abrirProduto();

      expect(ultimo?.reviews).toEqual([AVALIACAO]);
    });
  });
});
