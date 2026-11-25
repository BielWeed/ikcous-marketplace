// @vitest-environment jsdom
//
// Mais três fronteiras do cache de avaliações por produto
// (`src/lib/cache-de-avaliacoes.ts`), que os testes vizinhos deixavam passar:
//  - esvaziar a memória (logout) NÃO pode deixar a cópia em memória viva: a
//    leitura seguinte só enxerga o que ainda estiver no aparelho;
//  - aparelho com a cota cheia (gravar falha) não derruba a tela nem perde a
//    lista: ela fica na memória e a leitura a devolve;
//  - a limpeza do aparelho só apaga chave que COMEÇA com o prefixo das
//    avaliações, nunca uma de outro dono que apenas o cita no meio do nome.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REVIEWS_CACHE_KEY_PREFIX,
  esquecerAvaliacoesGuardadas,
  esvaziarAvaliacoesEmMemoria,
  getReviewsCache,
  updateReviewsCache,
} from "@/lib/cache-de-avaliacoes";
import type { Review } from "@/types";

const avaliacao = (id: string): Review => ({
  id,
  productId: "p1",
  customerName: "Maria S.",
  rating: 5,
  comment: "Ótimo",
  verified: false,
  helpful: 0,
  createdAt: "2026-11-01T12:00:00Z",
});

const chave = (produto: string) => `${REVIEWS_CACHE_KEY_PREFIX}${produto}`;

beforeEach(() => {
  localStorage.clear();
  esquecerAvaliacoesGuardadas();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("esvaziar a memória no logout", () => {
  it("a cópia em memória some: sem nada no aparelho, a leitura volta vazia", () => {
    updateReviewsCache("p1", [avaliacao("r1")]);
    expect(getReviewsCache("p1")).toHaveLength(1);

    // O aparelho perdeu a cópia (outra aba limpou, por exemplo)...
    localStorage.removeItem(chave("p1"));
    // ...e o logout esvazia a memória desta aba.
    esvaziarAvaliacoesEmMemoria();

    expect(getReviewsCache("p1")).toBeNull();
  });

  it("a cópia que segue no aparelho continua valendo depois de esvaziar a memória", () => {
    updateReviewsCache("p1", [avaliacao("r1")]);
    esvaziarAvaliacoesEmMemoria();
    expect(getReviewsCache("p1")).toEqual([avaliacao("r1")]);
  });
});

describe("aparelho com a cota cheia", () => {
  it("gravar falha: não lança, e a lista fica na memória desta aba", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const aparelho = globalThis.localStorage;
    try {
      vi.stubGlobal("localStorage", {
        length: 0,
        key: () => null,
        getItem: () => null,
        removeItem: () => {},
        setItem: () => {
          throw new DOMException("cota cheia", "QuotaExceededError");
        },
      });

      expect(() => updateReviewsCache("p1", [avaliacao("r1")])).not.toThrow();

      expect(getReviewsCache("p1")).toEqual([avaliacao("r1")]);
    } finally {
      vi.stubGlobal("localStorage", aparelho);
    }
  });
});

describe("a limpeza só apaga chave que COMEÇA com o prefixo das avaliações", () => {
  it("chave de outro dono que cita o prefixo no meio do nome fica", () => {
    const deOutroDono = `outro_dono_${REVIEWS_CACHE_KEY_PREFIX}p1`;
    localStorage.setItem(deOutroDono, "intocada");
    localStorage.setItem(chave("p1"), "[]");

    esquecerAvaliacoesGuardadas();

    expect(localStorage.getItem(chave("p1"))).toBeNull();
    expect(localStorage.getItem(deOutroDono)).toBe("intocada");
  });
});
