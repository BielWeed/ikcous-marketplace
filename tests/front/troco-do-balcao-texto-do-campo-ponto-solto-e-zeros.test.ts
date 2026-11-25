// O texto que o campo de dinheiro do balcão entrega à conta do troco
// (`centavosDoTextoEmReais`, em `src/lib/troco-do-balcao.ts`). A regra é
// "nunca um troco inventado": o que não é um valor inteiro e claro vira `null`.
// Os testes do módulo cobrem vazio, negativo e 3 casas; ficaram sem prova o
// ponto sem casas depois dele ("50.") e os zeros à esquerda.
import { centavosDoTextoEmReais } from "@/lib/troco-do-balcao";
import { describe, expect, it } from "vitest";

describe("centavosDoTextoEmReais — ponto solto e zeros", () => {
  it.each([
    ["ponto no fim, sem centavos", "50."],
    ["só o ponto", "."],
    ["ponto no começo, sem reais", ".50"],
    ["dois pontos", "1.2.3"],
    ["vírgula no lugar do ponto", "50,00"],
    ["notação científica", "1e3"],
    ["negativo", "-5"],
    ["três casas", "12.505"],
    ["letra no meio", "1a2"],
    ["vazio", ""],
    ["só espaços", "   "],
  ])("%s não vira valor", (_nome, texto) => {
    expect(centavosDoTextoEmReais(texto)).toBeNull();
  });

  it.each([
    ["zero", "0", 0],
    ["zero com centavos", "0.05", 5],
    ["zeros à esquerda na parte inteira", "00.10", 10],
    ["zeros à esquerda sem decimais", "050", 5000],
    ["uma casa decimal vale décimos", "12.5", 1250],
    ["espaços nas pontas são ignorados", "  12.50  ", 1250],
    ["duas casas", "20.05", 2005],
  ])("%s: '%s' vale %i centavos", (_nome, texto, esperado) => {
    expect(centavosDoTextoEmReais(texto)).toBe(esperado);
  });
});
