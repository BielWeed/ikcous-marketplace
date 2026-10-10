import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { describe, expect, it } from "vitest";

describe("numeroDoPedido", () => {
  it("são os 6 últimos caracteres do id, em maiúsculas (o padrão do painel, do PDV e do WhatsApp)", () => {
    expect(numeroDoPedido("c35ce4dd-1234-4abc-8def-1a2b3c3884be")).toBe(
      "3884BE",
    );
  });

  it("id curto não quebra, e ausente vira vazio (nunca 'undefined')", () => {
    expect(numeroDoPedido("ab12")).toBe("AB12");
    expect(numeroDoPedido("")).toBe("");
    expect(numeroDoPedido(undefined)).toBe("");
    expect(numeroDoPedido(null)).toBe("");
  });
});
