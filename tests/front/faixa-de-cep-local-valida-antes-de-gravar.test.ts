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
    "01310-000 a 01399-999",
    "01310000 até 01399999",
    "01310000;01399999",
    "01310000/01399999",
    "01310-000 - 01399-999",
    "01310000 01399999",
    "CEP 01310-000",
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
    "01.310-000",
    "01.310-000, 01.399-999",
    "38.400-000",
    "01310100, 01310200",
    "01310-100, 01310-200",
    "013101-013102",
    "01310100 - 01310200",
  ])("aceita %j", (faixa) => {
    expect(erroDaFaixaDeCepLocal(faixa)).toBeNull();
  });
});
