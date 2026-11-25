// Achado por mutação, 25/11/2026: trocar `valor > 0` por `valor >= 0` (ou apagar
// a guarda) em `cupomPodeCobrirACompraInteira` deixava a suíte inteira verde.
// Um cupom de valor ZERO não desconta nada, então nunca cobre compra nenhuma;
// mas com um mínimo de compra menor que meio centavo, o `atingiuOMinimo` (que
// compara em centavos inteiros) arredonda os dois lados para 0 e dizia que o
// "desconto" de R$ 0,00 cobria o pedido: o painel mostrava o aviso de "cupom
// que zera a compra" num cupom que não faz nada.
import { cupomPodeCobrirACompraInteira } from "@/lib/cupom-que-cobre-a-compra";
import { describe, expect, it } from "vitest";

describe("cupomPodeCobrirACompraInteira — valor zero nunca cobre", () => {
  it("fixo de R$ 0,00 com mínimo abaixo de meio centavo não cobre", () => {
    expect(
      cupomPodeCobrirACompraInteira({
        type: "fixed",
        value: 0,
        minPurchase: 0.004,
      }),
    ).toBe(false);
    expect(
      cupomPodeCobrirACompraInteira({
        type: "fixed",
        value: 0,
        minPurchase: 0.001,
      }),
    ).toBe(false);
  });

  it("valor ausente, nulo ou negativo também não cobre, com ou sem mínimo", () => {
    expect(
      cupomPodeCobrirACompraInteira({ type: "fixed", minPurchase: 0.004 }),
    ).toBe(false);
    expect(
      cupomPodeCobrirACompraInteira({
        type: "fixed",
        value: -10,
        minPurchase: 0.004,
      }),
    ).toBe(false);
    expect(
      cupomPodeCobrirACompraInteira({ type: "percentage", value: 0 }),
    ).toBe(false);
  });

  it("controle: o mesmo mínimo minúsculo com valor positivo que alcança o mínimo cobre", () => {
    expect(
      cupomPodeCobrirACompraInteira({
        type: "fixed",
        value: 0.01,
        minPurchase: 0.004,
      }),
    ).toBe(true);
  });
});
