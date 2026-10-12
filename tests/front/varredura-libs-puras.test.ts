import { describe, expect, it } from "vitest";

import { destaqueDoCupom } from "@/lib/cupons-do-checkout";
import { mapProductFromDB } from "@/lib/mappers";
import { valorDevolverAgora } from "@/lib/valor-devolver-agora";
import { limparNumero, precoDaLinha } from "@/utils/preco-da-grade";

describe("varredura libs-puras", () => {
  describe("preco-da-grade: milhar em pt-BR", () => {
    it("'1.234,56' vale 1234.56", () => {
      expect(precoDaLinha("1.234,56")).toBe(1234.56);
      expect(limparNumero("1.234,56")).toBe("1234.56");
    });
    it("'1.234' (3 digitos apos o ponto) vale 1234", () => {
      expect(precoDaLinha("1.234")).toBe(1234);
    });
    it("'1.234.567,5' vale 1234567.5", () => {
      expect(precoDaLinha("1.234.567,5")).toBe(1234567.5);
    });
    it("'89,90' e '89.90' continuam 89.9", () => {
      expect(precoDaLinha("89,90")).toBe(89.9);
      expect(precoDaLinha("89.90")).toBe(89.9);
      expect(limparNumero("89,90")).toBe("89.90");
    });
  });

  describe("mappers: nota do produto", () => {
    const base = { id: "p1", nome: "X", preco_venda: 10 };
    it("nota 0 com avaliacoes fica 0", () => {
      expect(
        mapProductFromDB({ ...base, rating: 0, review_count: 3 }).rating,
      ).toBe(0);
      expect(
        mapProductFromDB({ ...base, rating: "0", review_count: 3 }).rating,
      ).toBe(0);
    });
    it("sem avaliacao nenhuma segue 5 (padrao intencional)", () => {
      expect(
        mapProductFromDB({ ...base, rating: null, review_count: 0 }).rating,
      ).toBe(5);
      expect(
        mapProductFromDB({ ...base, rating: 0, review_count: 0 }).rating,
      ).toBe(5);
    });
  });

  describe("valorDevolverAgora em centavos", () => {
    it("0.3 - 0.1 devolve exatamente 0.2", () => {
      expect(
        valorDevolverAgora({ total: 0.3, valorDevolvidoPorDevolucao: 0.1 }),
      ).toBe(0.2);
    });
    it("0.3 - 0.2 devolve exatamente 0.1 (float dava 0.09999999999999998)", () => {
      expect(valorDevolverAgora({ total: 0.3, valorEstornado: 0.2 })).toBe(0.1);
    });
  });

  describe("destaqueDoCupom: arredonda a centavos", () => {
    it("14.999 vira 'R$ 15'", () => {
      expect(destaqueDoCupom({ tipo: "fixed", valor: 14.999 })).toBe("R$ 15");
    });
    it("14.5 segue 'R$ 14,50'", () => {
      expect(destaqueDoCupom({ tipo: "fixed", valor: 14.5 })).toBe("R$ 14,50");
    });
  });
});
