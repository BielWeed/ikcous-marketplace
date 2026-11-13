// Conta do troco no balcão (aba Vender, pagamento em dinheiro). Tudo em
// CENTAVOS inteiros: os valores abaixo são escritos à mão, não derivados da
// função que se testa.
import { describe, expect, it } from "vitest";

import {
  calcularTroco,
  centavosDoTextoEmReais,
  sugerirNotas,
} from "@/lib/troco-do-balcao";

describe("calcularTroco", () => {
  it("R$ 29,95 pagos com R$ 50,00 dão R$ 20,05 de troco (ponto flutuante daria 20,049999…)", () => {
    expect(calcularTroco(2995, 5000)).toEqual({
      tipo: "troco",
      centavos: 2005,
    });
  });

  it("R$ 0,10 + R$ 0,20 não vira R$ 0,30000000000000004: R$ 0,30 pagos com R$ 0,60 dão R$ 0,30", () => {
    expect(calcularTroco(30, 60)).toEqual({ tipo: "troco", centavos: 30 });
  });

  it("pagamento exato: troco zero (continua sendo troco, não falta)", () => {
    expect(calcularTroco(13700, 13700)).toEqual({ tipo: "troco", centavos: 0 });
  });

  it("valor menor que o total: faltam os centavos que faltam", () => {
    expect(calcularTroco(13700, 10000)).toEqual({
      tipo: "faltam",
      centavos: 3700,
    });
    expect(calcularTroco(2995, 2994)).toEqual({ tipo: "faltam", centavos: 1 });
  });

  it("campo vazio (ou ilegível): não há o que mostrar", () => {
    expect(calcularTroco(13700, null)).toBeNull();
  });

  it("total zero: qualquer valor dado volta inteiro como troco", () => {
    expect(calcularTroco(0, 500)).toEqual({ tipo: "troco", centavos: 500 });
  });

  it("valores muito grandes continuam exatos", () => {
    expect(calcularTroco(999_999_999_99, 1_000_000_000_00)).toEqual({
      tipo: "troco",
      centavos: 1,
    });
  });
});

describe("sugerirNotas", () => {
  it("R$ 137,00 sugere R$ 140, R$ 150 e R$ 200 (em centavos)", () => {
    expect(sugerirNotas(13700)).toEqual([14000, 15000, 20000]);
  });

  it("total redondo (R$ 100,00) NÃO sugere o próprio total: só valores acima", () => {
    expect(sugerirNotas(10000)).toEqual([10500, 11000, 12000]);
  });

  it("R$ 29,95 sugere R$ 30, R$ 40 e R$ 50", () => {
    expect(sugerirNotas(2995)).toEqual([3000, 4000, 5000]);
  });

  it("R$ 3,50 sugere R$ 5, R$ 10 e R$ 20", () => {
    expect(sugerirNotas(350)).toEqual([500, 1000, 2000]);
  });

  it("R$ 0,01 (o menor total possível) sugere R$ 5, R$ 10 e R$ 20", () => {
    expect(sugerirNotas(1)).toEqual([500, 1000, 2000]);
  });

  it("total zero (venda de graça): nada a cobrar, nada a sugerir", () => {
    expect(sugerirNotas(0)).toEqual([]);
  });

  it("entrada estranha (negativa, quebrada, NaN): nada a sugerir", () => {
    expect(sugerirNotas(-100)).toEqual([]);
    expect(sugerirNotas(10.5)).toEqual([]);
    expect(sugerirNotas(Number.NaN)).toEqual([]);
  });

  it("total muito grande (R$ 12.345,67): continua devolvendo só valores acima, em ordem, no máximo 3", () => {
    const sugestoes = sugerirNotas(1_234_567);
    // 12.350 (múltiplo de 5, 10 e 50), 12.360 (de 20) e 12.400 (de 100 e 200).
    expect(sugestoes).toEqual([1_235_000, 1_236_000, 1_240_000]);
    expect(sugestoes.every((v) => v > 1_234_567)).toBe(true);
  });

  it("nunca passa de 3 e nunca repete", () => {
    for (const total of [1, 99, 500, 501, 9999, 10000, 19999, 20000, 123456]) {
      const s = sugerirNotas(total);
      expect(s.length).toBeLessThanOrEqual(3);
      expect(new Set(s).size).toBe(s.length);
      expect(s.every((v) => v > total)).toBe(true);
      expect([...s].sort((a, b) => a - b)).toEqual(s);
    }
  });
});

describe("centavosDoTextoEmReais (o texto que o campo de dinheiro entrega)", () => {
  it('"50.00" são 5000 centavos; "0.05" são 5; "1234.5" são 123450', () => {
    expect(centavosDoTextoEmReais("50.00")).toBe(5000);
    expect(centavosDoTextoEmReais("0.05")).toBe(5);
    expect(centavosDoTextoEmReais("1234.5")).toBe(123450);
    expect(centavosDoTextoEmReais("137")).toBe(13700);
  });

  it("não passa por ponto flutuante: 20.05 são 2005 (20.05*100 daria 2004.9999…)", () => {
    expect(centavosDoTextoEmReais("20.05")).toBe(2005);
    expect(centavosDoTextoEmReais("1.15")).toBe(115);
  });

  it("vazio, só espaços, lixo e negativo: não é valor", () => {
    expect(centavosDoTextoEmReais("")).toBeNull();
    expect(centavosDoTextoEmReais("   ")).toBeNull();
    expect(centavosDoTextoEmReais("abc")).toBeNull();
    expect(centavosDoTextoEmReais("-5.00")).toBeNull();
    expect(centavosDoTextoEmReais("1.234")).toBeNull();
  });

  it("número grande demais para ser exato: não é valor (nunca um troco inventado)", () => {
    expect(centavosDoTextoEmReais("1000000000000000000.00")).toBeNull();
  });

  it('mais de um ponto ("50.00.00") não é valor e NÃO calcula troco', () => {
    expect(centavosDoTextoEmReais("50.00.00")).toBeNull();
    // Venda de R$ 29,95: sem valor lido, não há troco nem "faltam" a mostrar.
    expect(calcularTroco(2995, centavosDoTextoEmReais("50.00.00"))).toBeNull();
  });
});
