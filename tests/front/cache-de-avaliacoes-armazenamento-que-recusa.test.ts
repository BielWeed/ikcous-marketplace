// @vitest-environment jsdom
//
// Cache de avaliações (`src/lib/cache-de-avaliacoes.ts`) num aparelho cujo
// armazenamento RECUSA: cota cheia na gravação, ou modo privado/política do
// navegador que lança até na contagem das chaves.
//  - cota cheia: a lista continua valendo na memória (a tela mostra), o erro vira
//    UMA linha no console e nunca sobe para a tela;
//  - logout com o armazenamento indisponível: não quebra o "Sair", e a memória
//    (que tem avaliações não aprovadas e nome de autor) é esvaziada do mesmo jeito.
//
// Armazenamento próprio por teste (`vi.stubGlobal`): este arquivo nunca usa o
// `localStorage` real, porque desfazer o dublê global deixa o do jsdom sem
// métodos neste Node.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REVIEWS_CACHE_KEY_PREFIX,
  esquecerAvaliacoesGuardadas,
  geracaoAtualDoCache,
  getReviewsCache,
  updateReviewsCache,
} from "@/lib/cache-de-avaliacoes";
import type { Review } from "@/types";

const avaliacao = (id: string): Review => ({
  id,
  productId: "p1",
  customerName: "Maria S.",
  rating: 4,
  comment: "Gostei",
  verified: false,
  helpful: 0,
  createdAt: "2026-10-01T12:00:00Z",
});

let mapa: Map<string, string>;
let aoGravar: (() => void) | null;
let aoContar: (() => void) | null;

beforeEach(() => {
  mapa = new Map();
  aoGravar = null;
  aoContar = null;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => {
      aoGravar?.();
      mapa.set(k, v);
    },
    removeItem: (k: string) => {
      mapa.delete(k);
    },
    key: (i: number) => [...mapa.keys()].at(i) ?? null,
    get length() {
      aoContar?.();
      return mapa.size;
    },
  });
  esquecerAvaliacoesGuardadas();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cache de avaliações — armazenamento que recusa", () => {
  it("cota cheia: a lista fica na memória, o erro vira uma linha no console e nada lança", () => {
    const erroDeCota = new DOMException("cheio", "QuotaExceededError");
    aoGravar = () => {
      throw erroDeCota;
    };
    const consoleErro = vi.spyOn(console, "error").mockImplementation(() => {});
    const lista = [avaliacao("r1")];

    expect(() => updateReviewsCache("p1", lista)).not.toThrow();

    expect(getReviewsCache("p1")).toBe(lista);
    expect(mapa.size).toBe(0);
    expect(consoleErro).toHaveBeenCalledTimes(1);
    expect(consoleErro).toHaveBeenCalledWith(
      "Failed to update reviews cache",
      erroDeCota,
    );
  });

  it("gravação que funciona NÃO escreve nada no console", () => {
    const consoleErro = vi.spyOn(console, "error").mockImplementation(() => {});

    updateReviewsCache("p1", [avaliacao("r1")]);

    expect(mapa.has(`${REVIEWS_CACHE_KEY_PREFIX}p1`)).toBe(true);
    expect(consoleErro).not.toHaveBeenCalled();
  });

  it("logout com o armazenamento indisponível: não lança, sobe a geração e esvazia a memória", () => {
    updateReviewsCache("p1", [avaliacao("r1")]);
    const geracaoAntes = geracaoAtualDoCache();
    aoContar = () => {
      throw new DOMException("bloqueado", "SecurityError");
    };

    expect(() => esquecerAvaliacoesGuardadas()).not.toThrow();

    expect(geracaoAtualDoCache()).toBe(geracaoAntes + 1);
    aoContar = null;
    // Se a memória NÃO tivesse sido esvaziada, a lista voltaria mesmo com o
    // armazenamento vazio.
    mapa.clear();
    expect(getReviewsCache("p1")).toBeNull();
  });
});
