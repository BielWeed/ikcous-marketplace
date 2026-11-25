import { taxaDeResposta } from "@/lib/taxa-de-resposta";
import { describe, expect, it } from "vitest";

// A "taxa de resposta" das telas Perguntas e Avaliações do painel. A regra que
// a lojista sente: o número é arredondado como dinheiro (1 de 3 é 33%, 2 de 3
// é 67%), mas uma fila incompleta NUNCA ganha "100%" nem barra cheia por
// arredondamento: falta responder, então o texto é "Quase 100%" e a barra para
// em 99.
describe("taxa de resposta do painel", () => {
  it.each([
    [0, 0],
    [0, -1],
    [3, 0],
  ])(
    "%i de %i: sem fila não há taxa, só um traço e barra vazia",
    (resp, total) => {
      expect(taxaDeResposta(resp, total)).toEqual({ text: "—", width: 0 });
    },
  );

  it("uma pergunta só, respondida, é 100% de verdade (não é fila vazia)", () => {
    expect(taxaDeResposta(1, 1)).toEqual({ text: "100%", width: 100 });
  });

  it("uma pergunta só, sem resposta, é 0%", () => {
    expect(taxaDeResposta(0, 1)).toEqual({ text: "0%", width: 0 });
  });

  it.each([
    [1, 3, "33%", 33],
    [2, 3, "67%", 67],
    [1, 8, "13%", 13], // 12,5 arredonda para cima
    [1, 6, "17%", 17],
    [1, 2, "50%", 50],
  ])(
    "%i de %i arredonda ao mais próximo: %s",
    (resp, total, texto, largura) => {
      expect(taxaDeResposta(resp, total)).toEqual({
        text: texto,
        width: largura,
      });
    },
  );

  it("99% de verdade continua 99%, não vira 'Quase 100%'", () => {
    expect(taxaDeResposta(99, 100)).toEqual({ text: "99%", width: 99 });
  });

  it("98 de 100 também fica 98%", () => {
    expect(taxaDeResposta(98, 100)).toEqual({ text: "98%", width: 98 });
  });

  it.each([
    [199, 200], // 99,5% arredonda para 100, mas falta uma
    [995, 1000],
    [499, 500],
    [9999, 10000],
  ])("%i de %i falta responder: 'Quase 100%' e barra em 99", (resp, total) => {
    expect(taxaDeResposta(resp, total)).toEqual({
      text: "Quase 100%",
      width: 99,
    });
  });

  it.each([
    [5, 5],
    [500, 500],
  ])("%i de %i, tudo respondido: 100% e barra cheia", (resp, total) => {
    expect(taxaDeResposta(resp, total)).toEqual({ text: "100%", width: 100 });
  });
});
