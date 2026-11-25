import { taxaDeResposta } from "@/lib/taxa-de-resposta";
import { describe, expect, it } from "vitest";

// Direto na função pura: até aqui só as telas (avaliações e perguntas) a
// exercitavam, e por um par de linhas (499 de 500, 500 de 500). O que fica
// de fora daquelas linhas é a fronteira entre "99%" honesto e "Quase 100%".
describe("taxaDeResposta", () => {
  it("sem nada na fila não há taxa: traço e barra vazia, nunca 0% nem 100%", () => {
    expect(taxaDeResposta(0, 0)).toEqual({ text: "—", width: 0 });
    // Contagem que chegou inconsistente (sem total) também não inventa taxa.
    expect(taxaDeResposta(3, 0)).toEqual({ text: "—", width: 0 });
    expect(taxaDeResposta(0, -1)).toEqual({ text: "—", width: 0 });
  });

  it("1 de 1 é 100% de verdade e 0 de 1 é 0% de verdade (não traço)", () => {
    expect(taxaDeResposta(1, 1)).toEqual({ text: "100%", width: 100 });
    expect(taxaDeResposta(0, 1)).toEqual({ text: "0%", width: 0 });
  });

  it("arredonda para o inteiro mais próximo, nem para baixo nem para cima", () => {
    expect(taxaDeResposta(1, 3)).toEqual({ text: "33%", width: 33 });
    expect(taxaDeResposta(2, 3)).toEqual({ text: "67%", width: 67 });
    expect(taxaDeResposta(1, 8)).toEqual({ text: "13%", width: 13 });
    expect(taxaDeResposta(1, 2)).toEqual({ text: "50%", width: 50 });
  });

  it("99% que é 99% de verdade continua sendo 99% (não vira 'Quase 100%')", () => {
    expect(taxaDeResposta(99, 100)).toEqual({ text: "99%", width: 99 });
    expect(taxaDeResposta(98, 100)).toEqual({ text: "98%", width: 98 });
    // 99,4% arredonda para 99 e segue como número.
    expect(taxaDeResposta(994, 1000)).toEqual({ text: "99%", width: 99 });
  });

  it("fila incompleta que arredonda para 100 vira 'Quase 100%' com barra em 99", () => {
    // 99,5% arredonda para 100, mas falta uma resposta.
    expect(taxaDeResposta(995, 1000)).toEqual({
      text: "Quase 100%",
      width: 99,
    });
    expect(taxaDeResposta(199, 200)).toEqual({
      text: "Quase 100%",
      width: 99,
    });
    expect(taxaDeResposta(1999, 2000)).toEqual({
      text: "Quase 100%",
      width: 99,
    });
  });

  it("fila completa é 100% e barra cheia, em qualquer tamanho", () => {
    for (const total of [1, 2, 7, 199, 200, 500, 2000, 100_000]) {
      expect(taxaDeResposta(total, total)).toEqual({
        text: "100%",
        width: 100,
      });
    }
  });

  it("varredura: barra cheia e '100%' só quando TODAS foram respondidas", () => {
    for (let total = 1; total <= 150; total++) {
      for (let respondidas = 0; respondidas <= total; respondidas++) {
        const { text, width } = taxaDeResposta(respondidas, total);
        if (respondidas === total) {
          expect(text).toBe("100%");
          expect(width).toBe(100);
        } else {
          expect(text).not.toBe("100%");
          expect(width).toBeLessThanOrEqual(99);
        }
        expect(width).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
