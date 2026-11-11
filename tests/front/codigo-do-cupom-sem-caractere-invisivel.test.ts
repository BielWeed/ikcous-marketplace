// Código de cupom colado do WhatsApp/Word leva caractere invisível (U+200B,
// U+200E, U+FEFF...). O `trim()`/`\s` do JavaScript não os tira: o painel
// gravava "PROMO10" com um invisível no fim e a cliente que digitava
// "PROMO10" recebia "Cupom inválido ou expirado". Código só de invisível
// também passava pela guarda de "código obrigatório".
import {
  codigoDoCupomParaSalvar,
  normalizarCodigoDoCupom,
} from "@/lib/codigo-do-cupom";
import { describe, expect, it } from "vitest";

describe("normalizarCodigoDoCupom — caractere invisível", () => {
  it("tira o espaço de largura zero do fim, do começo e do meio", () => {
    expect(normalizarCodigoDoCupom("VERAO10\u200b")).toBe("VERAO10");
    expect(normalizarCodigoDoCupom("\u200e10OFF")).toBe("10OFF");
    expect(normalizarCodigoDoCupom("PRO\u200bMO10")).toBe("PROMO10");
  });

  it("tira cada um dos invisíveis que o WhatsApp e o Word colam", () => {
    for (const invisivel of [
      "\u200b", // espaço de largura zero
      "\u200c", // não-junção
      "\u200d", // junção
      "\u2060", // junção de palavras
      "\u00ad", // hífen suave
      "\u200e", // marca esquerda-para-direita
      "\u200f", // marca direita-para-esquerda
      "\ufeff", // BOM / espaço de largura zero sem quebra
    ]) {
      expect(
        normalizarCodigoDoCupom(`PRO${invisivel}MO10${invisivel}`),
        `U+${invisivel.codePointAt(0)?.toString(16)}`,
      ).toBe("PROMO10");
    }
  });

  it("código só de invisíveis vira vazio (a guarda de 'obrigatório' pega)", () => {
    expect(normalizarCodigoDoCupom("\u200b")).toBe("");
    expect(normalizarCodigoDoCupom("\u200b\u200e\ufeff\u2060")).toBe("");
    expect(normalizarCodigoDoCupom(" \u200b ")).toBe("");
  });

  it("controle: acento, espaço e maiúscula continuam como antes", () => {
    expect(normalizarCodigoDoCupom("verão10")).toBe("VERAO10");
    expect(normalizarCodigoDoCupom("  ver ao 10 ")).toBe("VERAO10");
    expect(normalizarCodigoDoCupom("Promoção Ç é")).toBe("PROMOCAOCE");
    expect(normalizarCodigoDoCupom("BEMVINDO10")).toBe("BEMVINDO10");
    expect(normalizarCodigoDoCupom("")).toBe("");
    expect(normalizarCodigoDoCupom(null)).toBe("");
    expect(normalizarCodigoDoCupom(undefined)).toBe("");
  });

  it("controle: letra, número e hífen visíveis não são tocados", () => {
    expect(normalizarCodigoDoCupom("promo-10_a")).toBe("PROMO-10_A");
  });
});

describe("codigoDoCupomParaSalvar — caractere invisível", () => {
  it("cupom antigo que a pessoa não mexeu segue intacto, mesmo com invisível gravado", () => {
    expect(codigoDoCupomParaSalvar("PROMO10\u200b", "PROMO10\u200b")).toBe(
      "PROMO10\u200b",
    );
    expect(codigoDoCupomParaSalvar("VERÃO10", "VERÃO10")).toBe("VERÃO10");
  });

  it("código digitado/colado com invisível é limpo ao salvar", () => {
    expect(codigoDoCupomParaSalvar("promo10\u200b", "")).toBe("PROMO10");
    expect(codigoDoCupomParaSalvar("promo20\u200b", "PROMO10")).toBe("PROMO20");
    expect(codigoDoCupomParaSalvar("\u200b", "")).toBe("");
  });
});
