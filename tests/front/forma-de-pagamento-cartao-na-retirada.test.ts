import { rotuloDaFormaDoPedido } from "@/lib/forma-de-pagamento";
import { describe, expect, it } from "vitest";

describe("cartão na entrega, retirada e balcão", () => {
  it.each([
    [undefined, undefined, "Cartão na entrega"],
    [false, "online", "Cartão na entrega"],
    [true, "online", "Cartão na retirada"],
    [false, "presencial", "Cartão na maquininha"],
    [true, "presencial", "Cartão na maquininha"],
  ] as const)(
    "retirada %s, canal %s: %s",
    (retiradaNaLoja, canal, esperado) => {
      expect(
        rotuloDaFormaDoPedido({ paymentMethod: "card", retiradaNaLoja, canal }),
      ).toBe(esperado);
    },
  );

  it("dinheiro na retirada continua Dinheiro", () => {
    expect(
      rotuloDaFormaDoPedido({ paymentMethod: "cash", retiradaNaLoja: true }),
    ).toBe("Dinheiro");
  });
});
