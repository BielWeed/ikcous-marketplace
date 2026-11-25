// Achado por mutação, 25/11/2026: tirar o `original &&` de `codigoDoCupomParaSalvar`
// deixava a suíte inteira verde. Sem essa guarda, um cupom NOVO cujo código
// ainda não existe (`original` ausente) e cujo campo veio igualmente ausente
// (`atual === original`, os dois `undefined` ou `null`) devolvia o próprio
// `undefined`/`null` no lugar do texto: o painel mandava `code: undefined` ao
// banco em vez de recusar o cupom sem código. A função promete SEMPRE texto.
import { codigoDoCupomParaSalvar } from "@/lib/codigo-do-cupom";
import { describe, expect, it } from "vitest";

describe("codigoDoCupomParaSalvar — cupom sem código original e sem código digitado", () => {
  it("os dois ausentes (undefined) devolvem texto vazio, nunca undefined", () => {
    expect(codigoDoCupomParaSalvar(undefined, undefined)).toBe("");
  });

  it("os dois nulos devolvem texto vazio, nunca null", () => {
    expect(codigoDoCupomParaSalvar(null, null)).toBe("");
  });

  it("ausente de um lado e nulo do outro também devolvem texto vazio", () => {
    expect(codigoDoCupomParaSalvar(undefined, null)).toBe("");
    expect(codigoDoCupomParaSalvar(null, undefined)).toBe("");
  });

  it("os dois vazios devolvem texto vazio", () => {
    expect(codigoDoCupomParaSalvar("", "")).toBe("");
  });

  it("original vazio e código digitado: normaliza o digitado (cupom novo)", () => {
    expect(codigoDoCupomParaSalvar(" verão 10 ", "")).toBe("VERAO10");
    expect(codigoDoCupomParaSalvar(" verão 10 ", null)).toBe("VERAO10");
    expect(codigoDoCupomParaSalvar(" verão 10 ", undefined)).toBe("VERAO10");
  });
});
