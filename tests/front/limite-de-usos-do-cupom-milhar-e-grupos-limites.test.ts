// Limite de usos do cupom digitado com ponto de milhar: o começo (antes do 1º
// ponto) tem 1 a 3 dígitos sem zero à esquerda, e TODOS os grupos seguintes
// têm exatamente 3 dígitos. Um grupo ruim entre grupos bons reprova o número
// inteiro (senão "1.000.12" gravaria 100012 usos em silêncio).
import { describe, expect, it } from "vitest";

import { lerLimiteDeUsosDoCupom } from "@/lib/limite-de-usos-do-cupom";

describe("lerLimiteDeUsosDoCupom: milhar e grupos", () => {
  it.each([
    ["1.000", 1000],
    ["12.000", 12000],
    ["123.000", 123000],
    ["123.456", 123456],
    ["999.999", 999999],
  ])("começo de 1, 2 ou 3 dígitos vale: %j é %d", (texto, esperado) => {
    expect(lerLimiteDeUsosDoCupom(texto)).toBe(esperado);
  });

  it.each([
    ["1234.000", "começo de 4 dígitos antes do ponto"],
    ["01.000", "zero à esquerda antes do ponto"],
    ["0.000", "começo zero antes do ponto"],
  ])("%j é formato inválido (%s)", (texto) => {
    expect(lerLimiteDeUsosDoCupom(texto)).toBe("formato");
  });

  it.each([
    ["1.000.12", "último grupo curto"],
    ["1.00.000", "grupo do meio curto"],
    ["1.000.0000", "último grupo longo"],
    ["1.000.000.", "ponto sobrando no fim"],
    ["1.000.abc", "grupo que não é número"],
  ])("%j reprova o número inteiro (%s), mesmo com grupo bom", (texto) => {
    expect(lerLimiteDeUsosDoCupom(texto)).toBe("formato");
  });
});
