// @vitest-environment jsdom
//
// Mais fronteiras do cache de avaliações (`src/lib/cache-de-avaliacoes.ts`), além
// das de `cache-de-avaliacoes-fronteiras-da-limpeza-e-do-formato.test.ts`:
//  - a gravação guarda a MESMA lista na memória (a cota cheia e o armazenamento
//    indisponível estão em `cache-de-avaliacoes-armazenamento-que-recusa.test.ts`);
//  - o teto de cópias por produto vale para avaliações: a 21ª visita apaga a
//    mais antiga em vez de encher o aparelho;
//  - a varredura do logout só apaga chave que COMEÇA com o prefixo (um nome que
//    o contém no meio é de outro dono);
//  - chave guardada vazia ("") é "sem cache" sem alarme no console.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REVIEWS_CACHE_KEY_PREFIX,
  esquecerAvaliacoesGuardadas,
  getReviewsCache,
  updateReviewsCache,
} from "@/lib/cache-de-avaliacoes";
import { LIMITE_DE_COPIAS } from "@/lib/copias-por-produto";
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

const chave = (produto: string) => `${REVIEWS_CACHE_KEY_PREFIX}${produto}`;

beforeEach(() => {
  localStorage.clear();
  esquecerAvaliacoesGuardadas();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("cache de avaliações — gravação normal", () => {
  it("gravação normal: a mesma lista (mesma referência) volta da memória", () => {
    const lista = [avaliacao("r1")];

    updateReviewsCache("p1", lista);

    expect(getReviewsCache("p1")).toBe(lista);
    expect(localStorage.getItem(chave("p1"))).toBe(JSON.stringify(lista));
  });
});

describe("cache de avaliações — o teto de cópias por produto", () => {
  it("a visita depois do teto apaga a cópia mais antiga e guarda a nova", () => {
    const produtos = Array.from(
      { length: LIMITE_DE_COPIAS + 1 },
      (_, i) => `p${i}`,
    );

    for (const produto of produtos) {
      updateReviewsCache(produto, [avaliacao(`r-${produto}`)]);
    }

    const guardados = produtos.filter(
      (produto) => localStorage.getItem(chave(produto)) !== null,
    );
    expect(guardados).toHaveLength(LIMITE_DE_COPIAS);
    expect(localStorage.getItem(chave("p0"))).toBeNull();
    expect(localStorage.getItem(chave(`p${LIMITE_DE_COPIAS}`))).not.toBeNull();
  });
});

describe("cache de avaliações — a varredura do logout", () => {
  it("só apaga a chave que COMEÇA com o prefixo; a que o contém no meio é de outro dono", () => {
    localStorage.setItem(chave("a"), "[]");
    localStorage.setItem(`outro_dono_${REVIEWS_CACHE_KEY_PREFIX}a`, "meu");

    esquecerAvaliacoesGuardadas();

    expect(localStorage.getItem(chave("a"))).toBeNull();
    expect(
      localStorage.getItem(`outro_dono_${REVIEWS_CACHE_KEY_PREFIX}a`),
    ).toBe("meu");
  });
});

describe("cache de avaliações — chave guardada vazia", () => {
  it("texto vazio é 'sem cache' e NÃO acende alarme no console", () => {
    const consoleErro = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(chave("p1"), "");

    expect(getReviewsCache("p1")).toBeNull();
    expect(consoleErro).not.toHaveBeenCalled();
  });
});
