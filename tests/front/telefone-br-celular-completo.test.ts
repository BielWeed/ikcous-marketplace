// O WhatsApp do checkout só vale com CELULAR COMPLETO (DDD + 9 + 8 dígitos).
// Antes a régua contava o TEXTO formatado (14 caracteres), e a máscara já
// chega a 14 caracteres com 10 dígitos ("(34) 98887-777") — o Finalizar abria
// com um número que não existe. A régua agora conta DÍGITOS, numa função só.
import { describe, expect, it } from "vitest";

import {
  celularBrasileiroCompleto,
  mascaraWhatsappBr,
  mensagemDeWhatsappIncompleto,
} from "@/lib/telefone-br";

/** Digita tecla a tecla, como a pessoa, passando pela máscara de verdade. */
function digitarNoCampo(digitos: string): string {
  let campo = "";
  for (const d of digitos) campo = mascaraWhatsappBr(campo + d, campo);
  return campo;
}

describe("celularBrasileiroCompleto — conta DÍGITOS, não caracteres", () => {
  it("o defeito: 10 dígitos já enchem 14 caracteres na máscara, e NÃO podem valer", () => {
    const campo = digitarNoCampo("3498887777");
    expect(campo).toBe("(34) 98887-777");
    expect(campo.length).toBe(14);
    expect(celularBrasileiroCompleto(campo)).toBe(false);
  });

  it.each([
    ["vazio", "", false],
    ["só DDD", "34", false],
    ["5 dígitos", "34988", false],
    ["9 dígitos", "349888777", false],
    ["10 dígitos (celular sem um número)", "3498887777", false],
    ["10 dígitos de telefone fixo", "3433334444", false],
    ["11 dígitos de celular", "34988877777", true],
    ["11 dígitos colados com +55 (13 dígitos)", "+55 34 98887-7777", true],
    ["13 dígitos com 55 na frente", "5534988877777", true],
    ["zero de tronco na frente", "034988877777", true],
    ["11 dígitos sem o 9 depois do DDD", "34288877777", false],
    ["DDD 55 (RS) com 11 dígitos", "55988877777", true],
    ["12 dígitos sem 55 (excedente)", "349888777777", false],
  ])("%s", (_nome, entrada, esperado) => {
    expect(celularBrasileiroCompleto(entrada)).toBe(esperado);
  });

  it("o texto já formatado e o cru dão o mesmo resultado", () => {
    expect(celularBrasileiroCompleto("(34) 98887-7777")).toBe(true);
    expect(celularBrasileiroCompleto("34988877777")).toBe(true);
    expect(celularBrasileiroCompleto("(34) 98887-777")).toBe(false);
  });

  it("null e undefined não passam", () => {
    expect(celularBrasileiroCompleto(null)).toBe(false);
    expect(celularBrasileiroCompleto(undefined)).toBe(false);
  });
});

describe("mensagemDeWhatsappIncompleto", () => {
  it("com um número a menos, diz exatamente o que faltou", () => {
    expect(mensagemDeWhatsappIncompleto("(34) 98887-777")).toBe(
      "Confira o WhatsApp: faltou um número (DDD + 9 + 8 dígitos)",
    );
  });

  it("com outra quantidade, pede o formato completo", () => {
    expect(mensagemDeWhatsappIncompleto("")).toBe(
      "Confira o WhatsApp: precisa de DDD + 9 + 8 dígitos",
    );
    expect(mensagemDeWhatsappIncompleto("(34) 9888")).toBe(
      "Confira o WhatsApp: precisa de DDD + 9 + 8 dígitos",
    );
  });
});
