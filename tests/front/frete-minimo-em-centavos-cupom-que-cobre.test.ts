// O aviso "este cupom pode cobrir a compra inteira" compara o valor fixo do
// cupom com o MÍNIMO de compra do próprio cupom. Se o valor chega como conta
// de ponto flutuante (10.10 + 10.20 = 20.299999999999997), ele ficava um
// resquício abaixo de 20.30 e o aviso sumia (16/10/2026).
import { cupomPodeCobrirACompraInteira } from "@/lib/cupom-que-cobre-a-compra";
import { describe, expect, it } from "vitest";

describe("cupomPodeCobrirACompraInteira — valor contra mínimo em centavos", () => {
  it("fixo 10.10 + 10.20 com mínimo 20.30: já cobre o mínimo -> avisa", () => {
    expect(
      cupomPodeCobrirACompraInteira({
        type: "fixed",
        value: 10.1 + 10.2,
        minPurchase: 20.3,
      }),
    ).toBe(true);
  });

  it("valores exatos (20.30 e 20.30) -> avisa", () => {
    expect(
      cupomPodeCobrirACompraInteira({
        type: "fixed",
        value: 20.3,
        minPurchase: 20.3,
      }),
    ).toBe(true);
  });

  it("CONTROLE: um centavo abaixo do mínimo (20.29 contra 20.30) não avisa", () => {
    expect(
      cupomPodeCobrirACompraInteira({
        type: "fixed",
        value: 20.29,
        minPurchase: 20.3,
      }),
    ).toBe(false);
  });
});
