import { parseValorBR } from "@/lib/financeiro";
import { describe, expect, it } from "vitest";

describe("parseValorBR — espaços em valores colados", () => {
  it.each([
    ["  R$ 10  ", 10],
    ["R$ 1 234", 1234],
    ["1 234,56", 1234.56],
    ["1 234 567,89", 1234567.89],
    ["1 234.56", 1234.56],
    ["-R$ 1 234,56", -1234.56],
  ])("lê %j como %s", (texto, reais) => {
    expect(parseValorBR(texto)).toBe(reais);
  });

  it.each([
    "R$ 7 50",
    "12 5",
    "1 23",
    "1234 567",
    "1 2345",
    "1  234",
    "1 234 56",
    "1 234,5 6",
    "1 234, 56",
    "1 234.567",
    "1.234 567,89",
  ])("recusa %j em vez de juntar os dígitos", (texto) => {
    expect(parseValorBR(texto)).toBeNull();
  });
});
