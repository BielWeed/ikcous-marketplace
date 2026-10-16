import { arredondarParaCentavos } from "@/lib/utils";
import { describe, expect, it } from "vitest";

describe("arredondarParaCentavos — metade para longe do zero como numeric", () => {
  it.each([
    [10.1 - 0.505, 9.6],
    [1.005, 1.01],
    [2.675, 2.68],
    [-1.005, -1.01],
    [-(10.1 - 0.505), -9.6],
    [9.5949, 9.59],
    [9.5951, 9.6],
    [-9.5949, -9.59],
    [0.005, 0.01],
    [-0.005, -0.01],
    [-0.004, 0],
    [-0, 0],
    [0, 0],
    [10.1, 10.1],
    [99_999_999.99, 99_999_999.99],
  ])("%s reais resulta em %s reais", (valor, esperado) => {
    expect(arredondarParaCentavos(valor)).toBe(esperado);
  });
});
