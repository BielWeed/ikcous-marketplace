// `atingiuOMinimo`: "o valor chegou ao mínimo?" comparado em CENTAVOS
// inteiros (mesma convenção `Math.round(x * 100)` de guarda-de-frete.ts e
// reconferirCarrinho.ts), porque 10.10 + 10.20 vale 20.299999999999997.
import { atingiuOMinimo } from "@/lib/atingiu-o-minimo";
import { describe, expect, it } from "vitest";

describe("atingiuOMinimo", () => {
  it("a soma que erra em ponto flutuante atinge o mínimo certo", () => {
    expect(atingiuOMinimo(10.1 + 10.2, 20.3)).toBe(true);
  });

  it("valor exato atinge", () => {
    expect(atingiuOMinimo(20.3, 20.3)).toBe(true);
  });

  it("um centavo abaixo NÃO atinge", () => {
    expect(atingiuOMinimo(20.29, 20.3)).toBe(false);
  });

  it("acima atinge; muito abaixo não", () => {
    expect(atingiuOMinimo(100, 20.3)).toBe(true);
    expect(atingiuOMinimo(0, 20.3)).toBe(false);
  });

  it("outros pares clássicos de ruído binário (0.1 + 0.2 contra 0.30; 1.1 * 3 contra 3.30)", () => {
    expect(atingiuOMinimo(0.1 + 0.2, 0.3)).toBe(true);
    expect(atingiuOMinimo(1.1 * 3, 3.3)).toBe(true);
  });

  it("valor que não é número nunca atinge (NaN não vira grátis)", () => {
    expect(atingiuOMinimo(Number.NaN, 20.3)).toBe(false);
    expect(atingiuOMinimo(20.3, Number.NaN)).toBe(false);
  });
});
