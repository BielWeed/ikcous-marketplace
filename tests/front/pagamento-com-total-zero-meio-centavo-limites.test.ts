// COMPRA QUE FECHA EM R$ 0,00: onde exatamente o total deixa de ser "zero".
// A conta é em centavos (`Math.round(total * 100)`): abaixo de meio centavo é
// ruído de ponto flutuante (zero); de meio centavo para cima já é 1 centavo a
// pagar, e o app SEMPRE cobra esse centavo (não esconde "No app").
import { describe, expect, it } from "vitest";

import { formasDePagamentoParaTotalZero } from "@/lib/pagamento-com-total-zero";

function decidir(totalFinal: number) {
  return formasDePagamentoParaTotalZero({
    totalFinal,
    freteFechado: true,
    modalidadeDaLoja: true,
    formasNaEntrega: ["pix", "cash"],
    paymentMethod: "pix",
  });
}

describe("total zero: fronteira do meio centavo", () => {
  it.each([
    ["ruído de ponto flutuante (0,004)", 0.004],
    ["quase meio centavo (0,00499)", 0.00499],
    ["zero exato", 0],
    ["troco negativo", -0.01],
  ])("%s ainda é compra sem valor a pagar", (_nome, total) => {
    const decisao = decidir(total);
    expect(decisao.zerado).toBe(true);
    expect(decisao.escondeApp).toBe(true);
  });

  it.each([
    ["exatamente meio centavo (0,005) arredonda para 1 centavo", 0.005],
    ["0,006 já é 1 centavo", 0.006],
    ["1 centavo", 0.01],
    ["1 centavo e pouco", 0.014],
  ])("%s: tem valor a pagar, a tela não muda", (_nome, total) => {
    const decisao = decidir(total);
    expect(decisao.zerado).toBe(false);
    expect(decisao.escondeApp).toBe(false);
    expect(decisao.travaPor).toBeNull();
    expect(decisao.bloqueiaFinalizar).toBe(false);
  });

  it("sem frete fechado o total é 'a calcular': nunca vira sem valor, nem com zero", () => {
    const decisao = formasDePagamentoParaTotalZero({
      totalFinal: 0,
      freteFechado: false,
      modalidadeDaLoja: true,
      formasNaEntrega: ["pix"],
      paymentMethod: "pix",
    });
    expect(decisao.zerado).toBe(false);
    expect(decisao.escondeApp).toBe(false);
  });
});
