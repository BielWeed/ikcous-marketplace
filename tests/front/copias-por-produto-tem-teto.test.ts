// @vitest-environment jsdom
//
// As cópias por produto (recomendações, avaliações, perguntas) não podem
// crescer sem fim no aparelho: com o armazenamento cheio, o carrinho do
// visitante deixava de ser salvo em silêncio. Teto por cache, cota cheia
// libera as cópias, e o que não é cópia nunca é tocado.
import {
  LIMITE_DE_COPIAS,
  PREFIXO_DE_AVALIACOES,
  PREFIXO_DE_PERGUNTAS,
  PREFIXO_DE_RECOMENDACOES,
  gravarCopiaPorProduto,
  liberarCopiasPorProduto,
} from "@/lib/copias-por-produto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmazenamentoComCota } from "./helpers/armazenamento-com-cota";

const grande = (n: number) => "x".repeat(n);

describe("cópias por produto — teto e cota cheia", () => {
  let armazem: ArmazenamentoComCota;

  const copiasDe = (prefixo: string) =>
    armazem.chaves().filter((c) => c.startsWith(prefixo));

  beforeEach(() => {
    armazem = new ArmazenamentoComCota(1_000_000);
    vi.stubGlobal("localStorage", armazem);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guarda só as últimas N cópias: as mais antigas saem e a nova entra", () => {
    for (let i = 0; i < LIMITE_DE_COPIAS + 5; i++) {
      gravarCopiaPorProduto(
        PREFIXO_DE_RECOMENDACOES,
        `${PREFIXO_DE_RECOMENDACOES}p${i}`,
        "[]",
      );
    }
    const guardadas = copiasDe(PREFIXO_DE_RECOMENDACOES);
    expect(guardadas).toHaveLength(LIMITE_DE_COPIAS);
    expect(guardadas).toContain(
      `${PREFIXO_DE_RECOMENDACOES}p${LIMITE_DE_COPIAS + 4}`,
    );
    expect(guardadas).not.toContain(`${PREFIXO_DE_RECOMENDACOES}p0`);
    expect(guardadas).not.toContain(`${PREFIXO_DE_RECOMENDACOES}p4`);
    expect(guardadas).toContain(`${PREFIXO_DE_RECOMENDACOES}p5`);
  });

  it("regravar o produto de sempre não gasta vaga nem expulsa outro; ele vira o mais novo", () => {
    for (let i = 0; i < LIMITE_DE_COPIAS; i++) {
      gravarCopiaPorProduto(
        PREFIXO_DE_AVALIACOES,
        `${PREFIXO_DE_AVALIACOES}p${i}`,
        "[]",
      );
    }
    // p0 é o mais antigo; regravá-lo o renova.
    gravarCopiaPorProduto(
      PREFIXO_DE_AVALIACOES,
      `${PREFIXO_DE_AVALIACOES}p0`,
      '["novo"]',
    );
    expect(copiasDe(PREFIXO_DE_AVALIACOES)).toHaveLength(LIMITE_DE_COPIAS);
    // Um produto novo agora expulsa o p1 (o mais antigo de verdade), não o p0.
    gravarCopiaPorProduto(
      PREFIXO_DE_AVALIACOES,
      `${PREFIXO_DE_AVALIACOES}outro`,
      "[]",
    );
    const guardadas = copiasDe(PREFIXO_DE_AVALIACOES);
    expect(guardadas).toContain(`${PREFIXO_DE_AVALIACOES}p0`);
    expect(guardadas).not.toContain(`${PREFIXO_DE_AVALIACOES}p1`);
    expect(armazem.getItem(`${PREFIXO_DE_AVALIACOES}p0`)).toBe('["novo"]');
  });

  it("cópias que já estavam no aparelho (sem registro de ordem) são as primeiras a sair", () => {
    // Quem já usava o app antes do teto chega com um monte de cópias soltas.
    for (let i = 0; i < 50; i++) {
      armazem.setItem(`${PREFIXO_DE_PERGUNTAS}velha${i}:pub`, "[]");
    }
    gravarCopiaPorProduto(
      PREFIXO_DE_PERGUNTAS,
      `${PREFIXO_DE_PERGUNTAS}recem:pub`,
      '["viva"]',
    );
    const guardadas = copiasDe(PREFIXO_DE_PERGUNTAS);
    expect(guardadas).toHaveLength(LIMITE_DE_COPIAS);
    // A que acabou de ser gravada sobrevive; só sobram antigas para o resto.
    expect(guardadas).toContain(`${PREFIXO_DE_PERGUNTAS}recem:pub`);
    expect(armazem.getItem(`${PREFIXO_DE_PERGUNTAS}recem:pub`)).toBe(
      '["viva"]',
    );
  });

  it("o teto de um cache não toca nas cópias dos outros nem no resto do aparelho", () => {
    armazem.setItem("marketplace_cart_v1", '[{"id":"a"}]');
    armazem.setItem("ikcous_last_shipping_cep", "01001000");
    for (let i = 0; i < 3; i++) {
      armazem.setItem(`${PREFIXO_DE_AVALIACOES}p${i}`, "[]");
    }
    for (let i = 0; i < LIMITE_DE_COPIAS + 3; i++) {
      gravarCopiaPorProduto(
        PREFIXO_DE_RECOMENDACOES,
        `${PREFIXO_DE_RECOMENDACOES}p${i}`,
        "[]",
      );
    }
    expect(copiasDe(PREFIXO_DE_AVALIACOES)).toHaveLength(3);
    expect(armazem.getItem("marketplace_cart_v1")).toBe('[{"id":"a"}]');
    expect(armazem.getItem("ikcous_last_shipping_cep")).toBe("01001000");
  });

  it("cota cheia: o cache libera as próprias cópias e a gravação nova entra", () => {
    armazem = new ArmazenamentoComCota(2_000);
    vi.stubGlobal("localStorage", armazem);
    armazem.setItem("marketplace_cart_v1", '[{"id":"a"}]');
    // Três cópias de ~600 caracteres: o aparelho fica sem espaço para a quarta.
    for (let i = 0; i < 3; i++) {
      armazem.setItem(`${PREFIXO_DE_RECOMENDACOES}p${i}`, grande(600));
    }
    expect(() =>
      gravarCopiaPorProduto(
        PREFIXO_DE_RECOMENDACOES,
        `${PREFIXO_DE_RECOMENDACOES}nova`,
        grande(600),
      ),
    ).not.toThrow();
    expect(armazem.getItem(`${PREFIXO_DE_RECOMENDACOES}nova`)).toBe(
      grande(600),
    );
    expect(armazem.getItem("marketplace_cart_v1")).toBe('[{"id":"a"}]');
  });

  it("cota cheia por causa de OUTRA coisa: o erro volta para quem chamou e nada é apagado à toa", () => {
    armazem = new ArmazenamentoComCota(1_000);
    vi.stubGlobal("localStorage", armazem);
    armazem.setItem("marketplace_cart_v1", grande(900));
    expect(() =>
      gravarCopiaPorProduto(
        PREFIXO_DE_RECOMENDACOES,
        `${PREFIXO_DE_RECOMENDACOES}p`,
        grande(600),
      ),
    ).toThrow(/quota/i);
    expect(armazem.getItem("marketplace_cart_v1")).toBe(grande(900));
  });

  it("armazenamento sem como listar as chaves: grava como antes, sem quebrar", () => {
    const simples = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => simples.get(k) ?? null,
      setItem: (k: string, v: string) => void simples.set(k, v),
      removeItem: (k: string) => void simples.delete(k),
    });
    expect(() =>
      gravarCopiaPorProduto(
        PREFIXO_DE_RECOMENDACOES,
        `${PREFIXO_DE_RECOMENDACOES}p`,
        "[1]",
      ),
    ).not.toThrow();
    expect(simples.get(`${PREFIXO_DE_RECOMENDACOES}p`)).toBe("[1]");
  });

  it("liberar apaga as cópias dos três caches (e a velha das recomendações) e só elas", () => {
    armazem.setItem("marketplace_cart_v1", '[{"id":"a"}]');
    armazem.setItem("favorites_visitante", '["a"]');
    armazem.setItem(`${PREFIXO_DE_RECOMENDACOES}a`, "[]");
    armazem.setItem(`${PREFIXO_DE_AVALIACOES}a`, "[]");
    armazem.setItem(`${PREFIXO_DE_PERGUNTAS}a:pub`, "[]");
    armazem.setItem("ikcous_recs_cache_a", "[]");
    gravarCopiaPorProduto(
      PREFIXO_DE_AVALIACOES,
      `${PREFIXO_DE_AVALIACOES}b`,
      "[]",
    );

    const apagadas = liberarCopiasPorProduto();

    expect(apagadas).toBe(5);
    expect(armazem.chaves().sort()).toEqual([
      "favorites_visitante",
      "marketplace_cart_v1",
    ]);
  });

  it("liberar num aparelho vazio ou bloqueado não quebra", () => {
    expect(liberarCopiasPorProduto()).toBe(0);
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("acesso bloqueado");
      },
    });
    expect(liberarCopiasPorProduto()).toBe(0);
  });
});
