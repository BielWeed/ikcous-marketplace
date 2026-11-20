import { lerLimiteDeUsosDoCupom } from "@/lib/limite-de-usos-do-cupom";
import { describe, expect, it } from "vitest";

describe("lerLimiteDeUsosDoCupom", () => {
  it.each([
    ["1000", 1000],
    ["1.000", 1000],
    ["10.000", 10000],
    ["1.000.000", 1000000],
    [" 1.000 ", 1000],
    ["", 0],
    ["0", 0],
    ["2.000.000.000", 2000000000],
    ["2000000000", 2000000000],
  ])("lê %j como %d", (texto, esperado) => {
    expect(lerLimiteDeUsosDoCupom(texto)).toBe(esperado);
  });

  it.each([
    "1.5",
    "1,5",
    "1.00",
    "1.0000",
    "1e3",
    "-1",
    "+1",
    "abc",
    "１０００",
    "1 000",
    "1000.000",
    "0.000",
  ])("recusa o formato %j sem reinterpretar o texto", (texto) => {
    expect(lerLimiteDeUsosDoCupom(texto)).toBe("formato");
  });

  it.each(["2.000.000.001", "2000000001", "999999999999999999999999999"])(
    "recusa %j acima do teto",
    (texto) => {
      expect(lerLimiteDeUsosDoCupom(texto)).toBe("teto");
    },
  );
});
