// Caça de mutação "só testes" (frete, 25/11/2026). Tirar a linha
// `if (finalC < 0) finalC = 0` de `precoComDescontoNacional` não derrubava
// nenhum teste: o desconto FIXO acima do preço já é cortado antes pelo
// `Math.min`, e o percentual só era testado em 100%, que dá exatamente zero.
// Percentual acima de 100 (digitado errado na tela, ou gravado por outra
// via) é o único caminho em que a conta passa de zero para o negativo, e uma
// prévia "→ R$ -12,45" no painel da lojista seria um preço que ninguém paga.
import { describe, expect, it } from "vitest";

import { precoComDescontoNacional } from "@/lib/estrategias-de-frete";

describe("precoComDescontoNacional — nunca devolve preço negativo", () => {
  it("percentual de 150% sobre R$ 24,90 vira R$ 0, não -R$ 12,45", () => {
    expect(precoComDescontoNacional(24.9, "percentual", 150)).toBe(0);
  });

  it("percentual de 101% (um ponto acima do limite) também vira zero", () => {
    expect(precoComDescontoNacional(10, "percentual", 101)).toBe(0);
  });

  it("controle: 99% de R$ 10 deixa R$ 0,10 (o limite de baixo continua pagando)", () => {
    expect(precoComDescontoNacional(10, "percentual", 99)).toBe(0.1);
  });

  it("fixo igual ao preço cheio zera; um centavo a menos deixa R$ 0,01", () => {
    expect(precoComDescontoNacional(24.9, "fixo", 24.9)).toBe(0);
    expect(precoComDescontoNacional(24.9, "fixo", 24.89)).toBe(0.01);
  });
});
