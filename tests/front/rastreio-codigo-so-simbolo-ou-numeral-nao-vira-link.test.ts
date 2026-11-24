// O que decide se um código de rastreio "serve para rastrear" é ter ao menos
// UMA letra ou UM dígito de verdade (`codigoDeRastreioTemLetraOuDigito`).
// Este arquivo protege as duas pontas dessa régua, que nenhum teste vigiava:
//  - letra/dígito não é só ASCII: código de transportadora com acento ou
//    algarismos de outro alfabeto continua gerando o botão "Rastrear";
//  - "número" que NÃO é dígito (expoente "²", fração "½", numeral romano "Ⅳ")
//    não conta — senão a cliente veria um link que leva a uma busca vazia.
import {
  codigoDeRastreioTemLetraOuDigito,
  linkDeRastreioDeCodigoValido,
  normalizarCodigoDeRastreio,
} from "@/lib/link-de-rastreio";
import { describe, expect, it } from "vitest";

const BASE = "https://www.melhorrastreio.com.br/rastreio/";

describe("codigoDeRastreioTemLetraOuDigito — o que conta como letra ou dígito", () => {
  it.each(["ÇÃO", "é", "١٢٣", "٣"])(
    "letra acentuada ou dígito de outro alfabeto (%s) conta",
    (codigo) => {
      expect(codigoDeRastreioTemLetraOuDigito(codigo)).toBe(true);
    },
  );

  it.each(["²", "½", "Ⅳ", "-²-", "—", "…", ""])(
    "só símbolo, expoente, fração ou numeral romano (%j) não conta",
    (codigo) => {
      expect(codigoDeRastreioTemLetraOuDigito(codigo)).toBe(false);
    },
  );

  it("uma letra no meio da pontuação basta", () => {
    expect(codigoDeRastreioTemLetraOuDigito("--²a²--")).toBe(true);
  });
});

describe("linkDeRastreioDeCodigoValido — não oferece link para código que é só símbolo", () => {
  it.each(["²", "½", "Ⅳ"])("%s não vira link", (codigo) => {
    expect(
      linkDeRastreioDeCodigoValido(normalizarCodigoDeRastreio(codigo)),
    ).toBe("");
  });

  it("código com letra acentuada vira link com o caminho codificado", () => {
    expect(
      linkDeRastreioDeCodigoValido(normalizarCodigoDeRastreio("ção")),
    ).toBe(`${BASE}${encodeURIComponent("ÇÃO")}`);
  });
});
