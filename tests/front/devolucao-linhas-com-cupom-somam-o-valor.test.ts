// Devolução de pedido COM CUPOM: cada item guarda o preço de UMA unidade já
// com o desconto e arredondado (`devolucao_elegibilidade`, migration
// 20261399992000), mas o servidor fecha o valor da devolução numa conta só,
// com o proporcional acumulado (`solicitar_devolucao`, 20261405400000).
// 30 x R$ 3,33 com cupom de 10% guarda R$ 3,00 por unidade (linha R$ 90,00),
// e o servidor grava R$ 89,91. A tela mostrava "R$ 90,00" na linha e
// "R$ 89,91" no total.
//
// `centavosDeCadaLinha` reparte o valor do SERVIDOR entre as linhas, na
// proporção de quantidade x preço, pelo maior resto: as linhas somam
// exatamente o valor gravado. Sem cupom, a parte de cada linha é a mesma
// quantidade x preço de sempre.
import { describe, expect, it } from "vitest";

import { centavosDeCadaLinha } from "@/lib/devolucao";

const linha = (quantidade: number, valor_unitario: number) => ({
  quantidade,
  valor_unitario,
});

const soma = (lista: readonly number[]) => lista.reduce((a, b) => a + b, 0);

describe("centavosDeCadaLinha: as linhas somam o valor que o servidor gravou", () => {
  it("30 x R$ 3,33 com cupom de 10%: a linha única mostra R$ 89,91, não R$ 90,00", () => {
    expect(centavosDeCadaLinha(8991, [linha(30, 3)])).toEqual([8991]);
  });

  it("3 x R$ 50,00 com cupom de R$ 2,00: a linha mostra R$ 148,00, não R$ 147,99", () => {
    expect(centavosDeCadaLinha(14800, [linha(3, 49.33)])).toEqual([14800]);
  });

  it("3 linhas de R$ 10,00 com cupom de R$ 2,00: cada uma R$ 9,33 e a soma é R$ 27,99", () => {
    const partes = centavosDeCadaLinha(2799, [
      linha(1, 9.33),
      linha(1, 9.33),
      linha(1, 9.33),
    ]);
    expect(partes).toEqual([933, 933, 933]);
    expect(soma(partes)).toBe(2799);
  });

  it("o centavo que sobra vai para a linha com o maior resto, e a soma fecha", () => {
    // 3 x R$ 49,33 (14799) e 1 x R$ 9,87 (987): o servidor gravou 14800 + 987.
    const partes = centavosDeCadaLinha(15787, [
      linha(3, 49.33),
      linha(1, 9.87),
    ]);
    expect(partes).toEqual([14800, 987]);
    expect(soma(partes)).toBe(15787);
  });

  it("centavo que falta sai da linha com o menor resto, e a soma fecha", () => {
    // Três linhas iguais de R$ 0,01 e o servidor gravou R$ 0,02.
    const partes = centavosDeCadaLinha(2, [
      linha(1, 0.01),
      linha(1, 0.01),
      linha(1, 0.01),
    ]);
    expect(soma(partes)).toBe(2);
    expect(partes).toEqual([1, 1, 0]);
  });

  it("sem cupom é quantidade x preço de cada linha, idêntico ao de antes", () => {
    const itens = [linha(2, 19.99), linha(1, 0.1), linha(3, 33.33)];
    expect(centavosDeCadaLinha(3998 + 10 + 9999, itens)).toEqual([
      3998, 10, 9999,
    ]);
  });

  it("uma linha só leva o valor inteiro do servidor", () => {
    expect(centavosDeCadaLinha(12345, [linha(7, 17.5)])).toEqual([12345]);
  });

  it("sem itens não há linha", () => {
    expect(centavosDeCadaLinha(1000, [])).toEqual([]);
  });

  it("valor zero (cupom de 100%) deixa toda linha em zero", () => {
    expect(centavosDeCadaLinha(0, [linha(2, 0), linha(1, 0)])).toEqual([0, 0]);
    expect(centavosDeCadaLinha(0, [linha(2, 10)])).toEqual([0]);
  });

  it("valor negativo nunca vira linha negativa", () => {
    expect(centavosDeCadaLinha(-500, [linha(1, 5)])).toEqual([0]);
  });

  it("linhas todas a R$ 0,00 com valor no servidor: nada a repartir, ficam em zero", () => {
    expect(centavosDeCadaLinha(500, [linha(1, 0), linha(2, 0)])).toEqual([
      0, 0,
    ]);
  });

  it("valor grande não perde centavo por ponto flutuante", () => {
    // 999 x R$ 99.999,99 com cupom: R$ 99.899.990,01 de valor no servidor.
    const itens = [linha(999, 99999.99), linha(1, 0.01)];
    const servidor = 9_989_999_001;
    const partes = centavosDeCadaLinha(servidor, itens);
    expect(soma(partes)).toBe(servidor);
    expect(partes.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
  });
});
