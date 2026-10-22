import { tipoDeEntregaDoPedido } from "@/lib/tipo-de-entrega-do-pedido";
import { describe, expect, it } from "vitest";

describe("tipoDeEntregaDoPedido", () => {
  it("balcão vence tudo", () => {
    expect(
      tipoDeEntregaDoPedido({
        canal: "presencial",
        retiradaNaLoja: true,
        shippingOptionId: "local-delivery",
      }),
    ).toBe("balcao");
  });
  it("retirada vence entrega local", () => {
    expect(
      tipoDeEntregaDoPedido({
        canal: "online",
        retiradaNaLoja: true,
        shippingOptionId: "local-delivery",
      }),
    ).toBe("retirada");
  });
  it("entrega local", () => {
    expect(tipoDeEntregaDoPedido({ shippingOptionId: "local-delivery" })).toBe(
      "entrega-local",
    );
  });
  it("o resto é envio (inclui cache antigo sem campos)", () => {
    expect(tipoDeEntregaDoPedido({})).toBe("envio");
    expect(
      tipoDeEntregaDoPedido({ canal: "online", shippingOptionId: "pac" }),
    ).toBe("envio");
    expect(tipoDeEntregaDoPedido({ shippingOptionId: null })).toBe("envio");
  });
});
