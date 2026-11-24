// O que este teste protege, em `@/utils/telefone` (a máscara do WhatsApp da
// tela "Sua conta" e a que mostra o WhatsApp no Perfil):
//  - `formatarWhatsAppParaExibicao`: valor já gravado com até 11 dígitos é
//    formatado; com 12 ou mais volta CRU, para a cliente ver que o número
//    gravado não cabe (antes ele era cortado e parecia um celular válido);
//  - `formatarWhatsAppDigitando`: mesma guarda enquanto a pessoa digita ou cola
//    ("+55 34 99999-8888" não pode virar "(55) 34999-9988", outro número);
//  - `validarWhatsApp`: exatamente 10 ou 11 dígitos (DDD + número).
// O teste vizinho (`telefone-mascara-progressiva.test.ts`) só cobre a digitação
// de até 11 dígitos; os limites e a exibição não tinham teste.
import {
  formatarWhatsAppDigitando,
  formatarWhatsAppParaExibicao,
  validarWhatsApp,
} from "@/utils/telefone";
import { describe, expect, it } from "vitest";

describe("formatarWhatsAppParaExibicao", () => {
  it.each([
    ["", ""],
    ["34", "34"],
    ["349", "(34) 9"],
    ["349999", "(34) 9999"],
    ["3499999", "(34) 9999-9"],
    ["3488887777", "(34) 8888-7777"],
    ["34988887777", "(34) 98888-7777"],
    ["(34) 98888-7777", "(34) 98888-7777"],
  ])("formata o valor gravado %j como %j", (gravado, esperado) => {
    expect(formatarWhatsAppParaExibicao(gravado)).toBe(esperado);
  });

  it.each(["5534988887777", "+55 34 98888-7777", "349888877770"])(
    "com mais de 11 dígitos (%s) devolve o valor cru, sem cortar",
    (gravado) => {
      expect(formatarWhatsAppParaExibicao(gravado)).toBe(gravado);
    },
  );
});

describe("formatarWhatsAppDigitando — limite de 11 dígitos", () => {
  it("com exatamente 11 dígitos ainda formata", () => {
    expect(formatarWhatsAppDigitando("34988887777")).toBe("(34) 98888-7777");
  });

  it.each(["+55 34 99999-8888", "349888877770", "5534988887777"])(
    "com mais de 11 dígitos (%s) devolve o texto como veio",
    (colado) => {
      expect(formatarWhatsAppDigitando(colado)).toBe(colado);
    },
  );

  it("o número colado com o código do país NÃO vira outro número válido", () => {
    const campo = formatarWhatsAppDigitando("+55 34 99999-8888");
    expect(campo).not.toBe("(55) 34999-9988");
    expect(validarWhatsApp(campo)).toBe(false);
  });
});

describe("validarWhatsApp", () => {
  it.each(["(34) 8888-7777", "3488887777", "(34) 98888-7777", "34988887777"])(
    "aceita %s (10 ou 11 dígitos)",
    (numero) => {
      expect(validarWhatsApp(numero)).toBe(true);
    },
  );

  it.each(["", "349888877", "(34) 98888-77770", "+55 34 98888-7777", "abc"])(
    "recusa %j (menos de 10 ou mais de 11 dígitos)",
    (numero) => {
      expect(validarWhatsApp(numero)).toBe(false);
    },
  );
});
