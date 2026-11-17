import { formatarWhatsAppDigitando } from "@/utils/telefone";
import { describe, expect, it } from "vitest";

describe("máscara progressiva do WhatsApp", () => {
  it.each([
    ["34", "34"],
    ["349", "(34) 9"],
    ["349999", "(34) 9999"],
    ["3499999", "(34) 9999-9"],
    ["3499999999", "(34) 9999-9999"],
    ["34999999999", "(34) 99999-9999"],
  ])("formata %s sem hífen pendente", (entrada, esperado) => {
    const resultado = formatarWhatsAppDigitando(entrada);
    expect(resultado).toBe(esperado);
    expect(resultado.endsWith("-")).toBe(false);
  });
});
