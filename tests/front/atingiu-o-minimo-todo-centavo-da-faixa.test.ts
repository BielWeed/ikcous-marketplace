// `atingiuOMinimo` — a fronteira vale para TODO valor em centavos, nao so para
// os pares classicos (20,30 / 0,30 / 3,30) que o teste do helper ja cobre.
//
// O que protege: o minimo do frete gratis e SEMPRE um valor com 2 casas (coluna
// numeric(10,2)). Alguns desses valores nao tem representacao exata em ponto
// flutuante e, multiplicados por 100, ficam um fio acima ou abaixo do inteiro
// (1,1 * 100 = 110.00000000000001; 1,15 * 100 = 114.99999999999999). Arredondar
// so um dos lados da comparacao (ou arredondar para cima/baixo em vez de para o
// mais proximo) faz a loja cobrar a entrega de quem comprou EXATAMENTE o minimo,
// ou liberar o frete um centavo antes — so para alguns valores de minimo.
import { atingiuOMinimo } from "@/lib/atingiu-o-minimo";
import { describe, expect, it } from "vitest";

const CENTAVOS_ATE_MIL_REAIS = 100_000;

describe("atingiuOMinimo em toda a faixa de centavos", () => {
  it("comprar exatamente o minimo atinge, qualquer que seja o minimo", () => {
    const falhas: number[] = [];
    for (let c = 1; c <= CENTAVOS_ATE_MIL_REAIS; c++) {
      if (!atingiuOMinimo(c / 100, c / 100)) falhas.push(c);
    }
    expect(falhas).toEqual([]);
  });

  it("um centavo abaixo do minimo nunca atinge, qualquer que seja o minimo", () => {
    const falhas: number[] = [];
    for (let c = 1; c <= CENTAVOS_ATE_MIL_REAIS; c++) {
      if (atingiuOMinimo((c - 1) / 100, c / 100)) falhas.push(c);
    }
    expect(falhas).toEqual([]);
  });

  it("um centavo acima do minimo sempre atinge", () => {
    const falhas: number[] = [];
    for (let c = 1; c <= CENTAVOS_ATE_MIL_REAIS; c++) {
      if (!atingiuOMinimo((c + 1) / 100, c / 100)) falhas.push(c);
    }
    expect(falhas).toEqual([]);
  });

  it("valores citados no codigo como armadilha de ponto flutuante", () => {
    // 1,1 * 100 sobra um fio acima; 1,15 * 100 falta um fio.
    expect(atingiuOMinimo(1.1, 1.1)).toBe(true);
    expect(atingiuOMinimo(1.14, 1.15)).toBe(false);
    expect(atingiuOMinimo(1.15, 1.15)).toBe(true);
  });
});
