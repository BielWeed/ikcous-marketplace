// A lojista que separa o pedido precisa ler QUAL variação a cliente comprou
// ("Cor Azul · Tamanho M"). O banco guarda a variação em duas colunas
// (`name` e `value`); quando o produto tem combinação, as duas trazem os
// atributos juntos com " / " ("Cor / Tamanho" + "Azul / M"). Este rótulo é a
// única fonte do texto que a ficha e o recibo mostram.
import { rotuloDaVariacao } from "@/lib/rotulo-da-variacao";
import { describe, expect, it } from "vitest";

describe("rotuloDaVariacao", () => {
  it("variação de um atributo só: 'Cor Rosa'", () => {
    expect(rotuloDaVariacao("Cor", "Rosa")).toBe("Cor Rosa");
  });

  it("combinação: um atributo por vez, separados por ponto médio", () => {
    expect(rotuloDaVariacao("Cor / Tamanho", "Azul / M")).toBe(
      "Cor Azul · Tamanho M",
    );
  });

  it("três atributos continuam na ordem em que foram cadastrados", () => {
    expect(
      rotuloDaVariacao("Cor / Tamanho / Tecido", "Preto / G / Linho"),
    ).toBe("Cor Preto · Tamanho G · Tecido Linho");
  });

  it("espaços sobrando nas pontas não aparecem no texto", () => {
    expect(rotuloDaVariacao("  Tamanho ", " M  ")).toBe("Tamanho M");
  });

  it("sem variação (nulo, indefinido ou vazio) não inventa texto", () => {
    expect(rotuloDaVariacao(null, null)).toBe("");
    expect(rotuloDaVariacao(undefined, undefined)).toBe("");
    expect(rotuloDaVariacao("", "")).toBe("");
    expect(rotuloDaVariacao("Cor", "")).toBe("");
    expect(rotuloDaVariacao("", "Azul")).toBe("");
  });

  it("linha antiga com contagens diferentes não perde nada: sai o texto cru", () => {
    expect(rotuloDaVariacao("Cor / Tamanho", "Azul")).toBe(
      "Cor / Tamanho Azul",
    );
  });
});
