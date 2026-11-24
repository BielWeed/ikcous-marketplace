// Caça por mutação (24/11/2026), território "estoque na vitrine". Quatro
// mutantes de `src/lib/vitrine.ts` sobreviviam aos testes que já existiam:
//
//  1. opção ATIVA sem `stockIncrement` informado (`undefined`) contava como
//     "com estoque" -- a mesma pergunta que `precoDeVitrine` já responde certo
//     (opção sem estoque informado não está à venda), e o cartão dizia
//     "Esgotado" enquanto a vitrine o ordenava como disponível;
//  2. produto com UMA única opção ativa esgotada, mas com o `stock` do produto
//     ainda positivo (número velho/de base), era tratado como disponível: a
//     regra de "uma escolha de cada grupo" só valia a partir de duas opções;
//  3. dois produtos sem `createdTime` empatavam em data de forma assimétrica
//     (um valia 0 e o outro 1), então o id nunca desempatava;
//  4. produto sem `id` no meio da lista derrubava a ordenação (TypeError).
//
// Este arquivo fixa as quatro bordas.
import { describe, expect, it } from "vitest";

import { ordenarParaVitrine, produtoDisponivel } from "@/lib/vitrine";

describe("produtoDisponivel — opção sem estoque informado", () => {
  it("opção ativa sem `stockIncrement` NÃO conta como com estoque", () => {
    expect(
      produtoDisponivel({
        stock: 5,
        variants: [{ name: "Tamanho", active: true }],
      }),
    ).toBe(false);
  });

  it("sem estoque informado numa opção, a outra do mesmo grupo com estoque vende", () => {
    expect(
      produtoDisponivel({
        stock: 5,
        variants: [
          { name: "Tamanho", active: true },
          { name: "Tamanho", active: true, stockIncrement: 2 },
        ],
      }),
    ).toBe(true);
  });

  it("sem estoque informado num GRUPO inteiro esgota o produto, mesmo com o outro grupo cheio", () => {
    expect(
      produtoDisponivel({
        stock: 9,
        variants: [
          { name: "Cor", active: true, stockIncrement: 4 },
          { name: "Tamanho", active: true },
        ],
      }),
    ).toBe(false);
  });
});

describe("produtoDisponivel — uma única opção ativa", () => {
  it("a única opção ativa esgotada esgota o produto, mesmo com `stock` positivo do produto", () => {
    expect(
      produtoDisponivel({
        stock: 3,
        variants: [{ name: "Tamanho", active: true, stockIncrement: 0 }],
      }),
    ).toBe(false);
  });

  it("a única opção ativa com estoque vende, mesmo com `stock` do produto zerado", () => {
    expect(
      produtoDisponivel({
        stock: 0,
        variants: [{ name: "Tamanho", active: true, stockIncrement: 4 }],
      }),
    ).toBe(true);
  });
});

describe("ordenarParaVitrine — desempate sem data", () => {
  it("dois produtos sem `createdTime` saem pelo id, em qualquer ordem de chegada", () => {
    const a = { id: "a", stock: 1 };
    const b = { id: "b", stock: 1 };
    expect(ordenarParaVitrine([a, b]).map((p) => p.id)).toEqual(["a", "b"]);
    expect(ordenarParaVitrine([b, a]).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("produto sem `id` entre produtos com id e mesma data não derruba a ordenação", () => {
    const comId = { id: "x", stock: 1, createdTime: 10 };
    const semId = { stock: 1, createdTime: 10 };
    expect(() => ordenarParaVitrine([comId, semId])).not.toThrow();
    expect(() => ordenarParaVitrine([semId, comId])).not.toThrow();
    expect(ordenarParaVitrine([comId, semId])).toHaveLength(2);
  });
});
