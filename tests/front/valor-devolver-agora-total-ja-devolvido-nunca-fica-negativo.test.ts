// "Devolver agora" nunca é negativo e conta em centavos exatos.
//
// A caça por mutação tirou o `Math.max(…, 0)` de `valorDevolverAgora` e nenhum
// teste caiu: o teste vizinho cobre só a função do ledger (que tem o próprio
// piso). Aqui, a função que decide se o pedido fica no balde "Devolver agora":
// quem já recebeu de volta MAIS que o total (devolução manual + estorno do
// Mercado Pago somados) deve R$ 0,00, nunca um valor negativo.
import { describe, expect, it } from "vitest";

import { valorDevolverAgora } from "@/lib/valor-devolver-agora";

describe("valorDevolverAgora: piso em zero e centavos exatos", () => {
  it("devolveu mais que o total (manual + estorno): fica R$ 0,00, não negativo", () => {
    expect(
      valorDevolverAgora({
        total: 100,
        valorDevolvidoPorDevolucao: 60,
        valorEstornado: 60,
      }),
    ).toBe(0);
  });

  it("devolveu exatamente o total: zero", () => {
    expect(
      valorDevolverAgora({
        total: 100,
        valorDevolvidoPorDevolucao: 40,
        valorEstornado: 60,
      }),
    ).toBe(0);
  });

  it("desconta os dois caminhos em centavos (29,90 − 10,10 − 0,20 = 19,60)", () => {
    expect(
      valorDevolverAgora({
        total: 29.9,
        valorDevolvidoPorDevolucao: 10.1,
        valorEstornado: 0.2,
      }),
    ).toBe(19.6);
  });

  it("campos ausentes ou nulos valem zero: o total inteiro", () => {
    expect(valorDevolverAgora({ total: 15.35 })).toBe(15.35);
    expect(
      valorDevolverAgora({
        total: 15.35,
        valorDevolvidoPorDevolucao: null,
        valorEstornado: null,
      }),
    ).toBe(15.35);
    expect(valorDevolverAgora({})).toBe(0);
  });
});
