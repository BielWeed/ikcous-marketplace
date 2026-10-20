// O servidor compara o código do cupom sem ignorar acento: "VERÃO10" criado
// no painel nunca casava com "VERAO10" digitado pela cliente ("Cupom inválido
// ou expirado"). O painel agora grava o código já sem acento.
import {
  codigoDoCupomParaSalvar,
  normalizarCodigoDoCupom,
} from "@/lib/codigo-do-cupom";
import { describe, expect, it } from "vitest";

describe("normalizarCodigoDoCupom", () => {
  it("tira acento e põe em maiúsculas", () => {
    expect(normalizarCodigoDoCupom("verão10")).toBe("VERAO10");
    expect(normalizarCodigoDoCupom("VERÃO10")).toBe("VERAO10");
    expect(normalizarCodigoDoCupom("Promoção Ç é")).toBe("PROMOCAOCE");
  });

  it("tira espaços de qualquer lugar, como antes", () => {
    expect(normalizarCodigoDoCupom("  ver ao 10 ")).toBe("VERAO10");
  });

  it("código sem acento fica igual", () => {
    expect(normalizarCodigoDoCupom("BEMVINDO10")).toBe("BEMVINDO10");
    expect(normalizarCodigoDoCupom("")).toBe("");
  });
});

describe("codigoDoCupomParaSalvar", () => {
  it("cupom existente com o código intacto: devolve o original com acento", () => {
    expect(codigoDoCupomParaSalvar("VERÃO10", "VERÃO10")).toBe("VERÃO10");
  });

  it("código alterado ou cupom novo: normaliza", () => {
    expect(codigoDoCupomParaSalvar("verão20", "VERÃO10")).toBe("VERAO20");
    expect(codigoDoCupomParaSalvar("verão10", "")).toBe("VERAO10");
    expect(codigoDoCupomParaSalvar("verão10", undefined)).toBe("VERAO10");
  });
});
