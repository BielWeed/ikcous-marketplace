// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviews } from "@/hooks/useReviews";
import {
  REVIEWS_CACHE_KEY_PREFIX,
  esquecerAvaliacoesGuardadas,
  getReviewsCache,
} from "@/lib/cache-de-avaliacoes";
import type { Review } from "@/types";

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

const h = vi.hoisted(() => ({
  linhas: [
    {
      id: "avaliacao-a",
      product_id: "produto-a",
      rating: 5,
      comment: "Comentário do produto A",
      created_at: "2026-11-10T12:00:00.000Z",
      helpful: 0,
      verified: true,
      author_name: "Visitante A",
      author_avatar_url: null,
      merchant_reply: null,
    },
    {
      id: "avaliacao-b",
      product_id: "produto-b",
      rating: 2,
      comment: "Comentário do produto B",
      created_at: "2026-11-09T12:00:00.000Z",
      helpful: 0,
      verified: false,
      author_name: "Visitante B",
      author_avatar_url: null,
      merchant_reply: null,
    },
  ],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "vw_reviews_public") {
        throw new Error(`Consulta inesperada: ${tabela}`);
      }
      let linhas = [...h.linhas];
      const builder = {
        select: () => builder,
        // Aplica o filtro às linhas: sem a guarda, os dois produtos chegam.
        eq: (coluna: string, valor: unknown) => {
          linhas = linhas.filter(
            (linha) => linha[coluna as keyof typeof linha] === valor,
          );
          return builder;
        },
        order: () => Promise.resolve({ data: linhas, error: null }),
      };
      return builder;
    },
  },
}));
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
    clear: () => armazem.clear(),
    key: (indice: number) => [...armazem.keys()].at(indice) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("visitante recebe somente as avaliações do produto consultado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: ReturnType<typeof useReviews> | undefined;

  function Sonda() {
    const retorno = useReviews();
    useEffect(() => {
      atual = retorno;
    });
    return null;
  }

  beforeEach(async () => {
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    esquecerAvaliacoesGuardadas();
    atual = undefined;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    esquecerAvaliacoesGuardadas();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("mantém A e B separados no estado, no cache em memória e na cópia do aparelho", async () => {
    const ids = (lista: Review[] | null | undefined) =>
      lista?.map((avaliacao) => avaliacao.id);

    for (const [produto, esperada, alheia] of [
      ["produto-a", "avaliacao-a", "avaliacao-b"],
      ["produto-b", "avaliacao-b", "avaliacao-a"],
    ]) {
      await act(async () => {
        await atual?.getReviewsByProduct(produto);
      });

      expect(ids(atual?.reviews)).toEqual([esperada]);
      expect(ids(atual?.reviews)).not.toContain(alheia);
      expect(ids(getReviewsCache(produto))).toEqual([esperada]);
      const copia = localStorage.getItem(
        `${REVIEWS_CACHE_KEY_PREFIX}${produto}`,
      );
      expect(copia).not.toBeNull();
      expect(ids(JSON.parse(copia ?? "null"))).toEqual([esperada]);
      expect(copia).not.toContain(alheia);
    }

    // Consultar B não deve sobrescrever a cópia já guardada de A.
    expect(ids(getReviewsCache("produto-a"))).toEqual(["avaliacao-a"]);
    expect(ids(getReviewsCache("produto-b"))).toEqual(["avaliacao-b"]);
  });
});
