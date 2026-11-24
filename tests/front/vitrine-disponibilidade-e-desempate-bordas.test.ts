// Bordas da regra unica da vitrine (src/lib/vitrine.ts) que a busca, a Home e a
// previa do painel dividem -- caca por mutacao, 24/11/2026:
//  - opcao DESLIGADA nao conta: nem para derrubar um produto que tem estoque
//    (so sobrou opcao desligada e zerada), nem para salvar um zerado;
//  - um grupo com varias escolhas basta UMA com estoque (a ordem das escolhas
//    nao muda o resultado: a ultima zerada nao apaga a primeira cheia);
//  - empate de data: o id MENOR vem primeiro, e produto sem id nao quebra a
//    ordenacao (fica na ordem em que chegou).
import { ordenarParaVitrine, produtoDisponivel } from "@/lib/vitrine";
import { describe, expect, it } from "vitest";

describe("produtoDisponivel -- opcao desligada e grupo com varias escolhas", () => {
  it("so opcao desligada e zerada: vale o estoque do produto (esta a venda)", () => {
    expect(
      produtoDisponivel({
        stock: 5,
        variants: [{ name: "Tamanho", active: false, stockIncrement: 0 }],
      }),
    ).toBe(true);
  });

  it("escolha desligada com estoque nao salva o grupo cuja escolha ativa esta zerada", () => {
    expect(
      produtoDisponivel({
        stock: 9,
        variants: [
          { name: "Cor", active: true, stockIncrement: 0 },
          { name: "Cor", active: false, stockIncrement: 9 },
        ],
      }),
    ).toBe(false);
  });

  it.each([
    ["cheia antes da zerada", [3, 0]],
    ["zerada antes da cheia", [0, 3]],
  ])(
    "grupo com duas escolhas, %s: uma com estoque basta",
    (_rotulo, saldos) => {
      expect(
        produtoDisponivel({
          stock: 3,
          variants: saldos.map((stockIncrement) => ({
            name: "Cor",
            active: true,
            stockIncrement,
          })),
        }),
      ).toBe(true);
    },
  );

  it("grupo com todas as escolhas zeradas continua esgotado", () => {
    expect(
      produtoDisponivel({
        stock: 3,
        variants: [
          { name: "Cor", active: true, stockIncrement: 0 },
          { name: "Cor", active: true, stockIncrement: 0 },
        ],
      }),
    ).toBe(false);
  });
});

describe("ordenarParaVitrine -- desempate de data", () => {
  it("mesma data: o id menor vem primeiro, qualquer que seja a ordem de chegada", () => {
    const chegada = [
      { id: "c", stock: 1, createdTime: 10 },
      { id: "a", stock: 1, createdTime: 10 },
      { id: "b", stock: 1, createdTime: 10 },
    ];
    expect(ordenarParaVitrine(chegada).map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(ordenarParaVitrine([...chegada].reverse()).map((p) => p.id)).toEqual(
      ["a", "b", "c"],
    );
  });

  it("produto sem id e mesma data: nao quebra e mantem a ordem de chegada", () => {
    const chegada = [
      { nome: "primeiro", stock: 1, createdTime: 10 },
      { nome: "segundo", stock: 1, createdTime: 10 },
      { nome: "terceiro", stock: 1, createdTime: 10 },
    ];
    expect(ordenarParaVitrine(chegada).map((p) => p.nome)).toEqual([
      "primeiro",
      "segundo",
      "terceiro",
    ]);
  });
});
