import { erroDaFaixaDeCepLocal } from "@/lib/cep-local";
import { describe, expect, it } from "vitest";

describe("formato da faixa de CEP a gravar", () => {
  it.each(["013101000", "01310-1000", "013101000-01310200", "013, 013101000"])(
    "detecta CEP longo demais em %s",
    (faixa) => {
      expect(erroDaFaixaDeCepLocal(faixa)).toBe("digitos-demais");
    },
  );

  it.each([
    "01310100 a 01310200",
    "01310100; 01310200",
    "01310100 até 01310200",
    "01310100 / 01310200",
  ])("detecta separador inválido em %s", (faixa) => {
    expect(erroDaFaixaDeCepLocal(faixa)).toBe("separador");
  });

  it.each([
    "",
    "  ",
    "0",
    "013",
    "0131010",
    "01310100",
    "01310-100",
    "01310100, 01310200",
    "01310-100, 01310-200",
    "013101-013102",
    "01310100 - 01310200",
  ])("aceita %j", (faixa) => {
    expect(erroDaFaixaDeCepLocal(faixa)).toBeNull();
  });
});
