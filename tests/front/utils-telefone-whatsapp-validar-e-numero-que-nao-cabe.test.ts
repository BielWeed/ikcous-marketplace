// Caça por mutação em `src/utils/telefone.ts` (máscara e validação do WhatsApp
// da conta). O teste que já existia só provava a máscara progressiva; estas
// trocas sobreviviam:
//   - `validarWhatsApp` aceitando 9 ou 12 dígitos (só 10 e 11 existem);
//   - a máscara cortando em 10 dígitos em vez de 11;
//   - a guarda do número que NÃO CABE (CONTA-08/09): acima de 11 dígitos o
//     texto volta como veio, para a validação recusar em vez de a máscara
//     fabricar OUTRO número válido.
// Só números fictícios.
import {
  formatarWhatsAppDigitando,
  formatarWhatsAppParaExibicao,
  validarWhatsApp,
} from "@/utils/telefone";
import { describe, expect, it } from "vitest";

describe("validarWhatsApp — DDD + número: exatamente 10 ou 11 dígitos", () => {
  it.each([
    ["3433331234", true], // fixo: 10
    ["34999998888", true], // celular: 11
    ["(34) 99999-8888", true], // com máscara
    ["343333123", false], // 9
    ["349999988889", false], // 12
    ["+55 34 99999-8888", false], // 13 com o país: não cabe
    ["", false],
    ["abc", false],
  ])("%s → %s", (entrada, esperado) => {
    expect(validarWhatsApp(entrada)).toBe(esperado);
  });
});

describe("formatarWhatsAppDigitando — celular completo e número que não cabe", () => {
  it("celular de 11 dígitos usa todos os dígitos", () => {
    expect(formatarWhatsAppDigitando("34999998888")).toBe("(34) 99999-8888");
  });

  it("fixo de 10 dígitos usa o hífen depois do 4º", () => {
    expect(formatarWhatsAppDigitando("3433331234")).toBe("(34) 3333-1234");
  });

  it("colar com o código do país (13 dígitos) NÃO é reinterpretado: o texto volta como veio", () => {
    // Antes (CONTA-09) virava "(55) 34999-9988": outro número, aprovado
    // pela validação sem aviso nenhum.
    expect(formatarWhatsAppDigitando("+55 34 99999-8888")).toBe(
      "+55 34 99999-8888",
    );
    expect(
      validarWhatsApp(formatarWhatsAppDigitando("+55 34 99999-8888")),
    ).toBe(false);
  });

  it("12 dígitos (um a mais que o celular) também volta como veio", () => {
    expect(formatarWhatsAppDigitando("349999988889")).toBe("349999988889");
  });
});

describe("formatarWhatsAppParaExibicao — valor já gravado", () => {
  it("celular e fixo gravados aparecem com a máscara inteira", () => {
    expect(formatarWhatsAppParaExibicao("34999998888")).toBe("(34) 99999-8888");
    expect(formatarWhatsAppParaExibicao("3433331234")).toBe("(34) 3333-1234");
  });

  it("número legado com mais de 11 dígitos aparece cru (verdadeiro, não 'consertado')", () => {
    expect(formatarWhatsAppParaExibicao("5534999998888")).toBe("5534999998888");
    expect(formatarWhatsAppParaExibicao("349999988889")).toBe("349999988889");
  });

  it("vazio continua vazio", () => {
    expect(formatarWhatsAppParaExibicao("")).toBe("");
  });
});
