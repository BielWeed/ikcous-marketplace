// @vitest-environment jsdom
//
// Cache de avaliações por produto (`src/lib/cache-de-avaliacoes.ts`): o que é
// dado de quem estava logado some no logout e na troca de conta. Caça por
// mutação (24/11/2026): os testes vizinhos exercitam o caminho principal, e
// estas fronteiras sobreviviam à troca do operador:
//  - a varredura do `localStorage` apaga TODAS as chaves de avaliação (mesmo
//    intercaladas com outras) e NENHUMA que não seja de avaliação (o carrinho,
//    o tema e o resto dos dados da cliente não podem ir junto);
//  - cada limpeza sobe a "geração": a resposta atrasada de quem acabou de sair
//    não grava nada, nem na memória nem no aparelho, tanto depois de
//    `esvaziarAvaliacoesEmMemoria` quanto de `esquecerAvaliacoesGuardadas`;
//  - `esvaziarAvaliacoesEmMemoria` esvazia SÓ a memória (o aparelho segue);
//  - formato ruim no disco (lista de listas, de texto, de número) vale como
//    "sem cache" e a chave é apagada; JSON quebrado não derruba a página;
//  - a memória vem primeiro: sem rede de disco, a segunda leitura é a mesma
//    lista.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REVIEWS_CACHE_KEY_PREFIX,
  esquecerAvaliacoesGuardadas,
  esvaziarAvaliacoesEmMemoria,
  geracaoAtualDoCache,
  getReviewsCache,
  updateReviewsCache,
  updateReviewsCacheSeMesmaGeracao,
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

const chave = (produto: string) => `${REVIEWS_CACHE_KEY_PREFIX}${produto}`;

beforeEach(() => {
  localStorage.clear();
  esquecerAvaliacoesGuardadas();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("cache de avaliações — a limpeza do aparelho", () => {
  it("apaga todas as chaves de avaliação, mesmo intercaladas, e preserva as outras", () => {
    localStorage.setItem("ikcous_carrinho", "carrinho");
    localStorage.setItem(chave("a"), "[]");
    localStorage.setItem("tema", "escuro");
    localStorage.setItem(chave("b"), "[]");
    localStorage.setItem(chave("c"), "[]");
    localStorage.setItem("ikcous_outra_coisa", "x");
    localStorage.setItem(chave("d"), "[]");

    esquecerAvaliacoesGuardadas();

    expect(
      Object.keys(localStorage)
        .filter((k) => k.startsWith(REVIEWS_CACHE_KEY_PREFIX))
        .sort(),
    ).toEqual([]);
    expect(localStorage.getItem("ikcous_carrinho")).toBe("carrinho");
    expect(localStorage.getItem("tema")).toBe("escuro");
    expect(localStorage.getItem("ikcous_outra_coisa")).toBe("x");
    expect(localStorage).toHaveLength(3);
  });

  it("esquecer também esvazia a memória: a leitura seguinte não acha nada", () => {
    updateReviewsCache("p1", [avaliacao("r1")]);

    esquecerAvaliacoesGuardadas();

    expect(getReviewsCache("p1")).toBeNull();
  });

  it("esvaziar em memória esvazia SÓ a memória: o aparelho segue com a cópia", () => {
    updateReviewsCache("p1", [avaliacao("r1")]);

    esvaziarAvaliacoesEmMemoria();

    expect(localStorage.getItem(chave("p1"))).not.toBeNull();
    expect(getReviewsCache("p1")?.map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("cache de avaliações — a resposta atrasada de quem saiu", () => {
  it("na mesma geração, grava (memória e aparelho) e devolve true", () => {
    const geracao = geracaoAtualDoCache();

    const gravou = updateReviewsCacheSeMesmaGeracao(
      "p1",
      [avaliacao("r1")],
      geracao,
    );

    expect(gravou).toBe(true);
    expect(localStorage.getItem(chave("p1"))).toContain("r1");
    expect(getReviewsCache("p1")?.map((r) => r.id)).toEqual(["r1"]);
  });

  it.each([
    ["esvaziarAvaliacoesEmMemoria (logout)", esvaziarAvaliacoesEmMemoria],
    [
      "esquecerAvaliacoesGuardadas (troca de conta)",
      esquecerAvaliacoesGuardadas,
    ],
  ])(
    "depois de %s, a resposta que partiu antes NÃO grava nada",
    (_nome, limpar) => {
      const geracaoDaLeitura = geracaoAtualDoCache();
      limpar();

      const gravou = updateReviewsCacheSeMesmaGeracao(
        "p1",
        [avaliacao("r-da-outra-conta")],
        geracaoDaLeitura,
      );

      expect(gravou).toBe(false);
      expect(geracaoAtualDoCache()).toBe(geracaoDaLeitura + 1);
      expect(localStorage.getItem(chave("p1"))).toBeNull();
      expect(getReviewsCache("p1")).toBeNull();
    },
  );
});

describe("cache de avaliações — o que o disco entrega", () => {
  it.each([
    ["lista de listas", "[[]]"],
    ["lista de texto", '["texto"]'],
    ["lista de número", "[1]"],
    ["lista com nulo", "[null]"],
    ["objeto solto", "{}"],
    ["texto", '"x"'],
  ])(
    "formato ruim (%s): vale como sem cache e a chave é apagada",
    (_nome, bruto) => {
      localStorage.setItem(chave("p1"), bruto);

      expect(getReviewsCache("p1")).toBeNull();

      expect(localStorage.getItem(chave("p1"))).toBeNull();
    },
  );

  it("lista vazia VÁLIDA é cache (devolve [], não null)", () => {
    localStorage.setItem(chave("p1"), "[]");

    expect(getReviewsCache("p1")).toEqual([]);
  });

  it("JSON quebrado: devolve null, registra o erro e não lança", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(chave("p1"), "{quebrado");

    expect(getReviewsCache("p1")).toBeNull();
    expect(erro).toHaveBeenCalledTimes(1);
  });

  it("a memória vem primeiro: lido uma vez do disco, a segunda leitura não precisa mais dele", () => {
    localStorage.setItem(chave("p1"), JSON.stringify([avaliacao("r1")]));

    const primeira = getReviewsCache("p1");
    localStorage.clear();
    const segunda = getReviewsCache("p1");

    expect(primeira?.map((r) => r.id)).toEqual(["r1"]);
    expect(segunda).toBe(primeira);
  });

  it("produto sem nada guardado: null", () => {
    expect(getReviewsCache("nunca-visto")).toBeNull();
  });
});
