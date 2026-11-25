// Identidade legal da loja (CNPJ/CPF, razão social e e-mail de contato que vão
// para a nota e para o rodapé). Duas lacunas:
//  1. a MÁSCARA que acompanha a lojista digitando: cada tamanho de texto tem a
//     sua forma (CPF até 11 números; CNPJ para mais ou para qualquer letra), e
//     nunca sobra ponto, barra ou traço pendurado no fim;
//  2. a linha "Responsável: …" só cita o documento quando há número E tipo, e a
//     vitrine sem config nenhuma não declara identidade.
import { describe, expect, it } from "vitest";

import {
  AVISO_DO_DOCUMENTO,
  formatarDocumento,
  identidadeLegalDaLoja,
  identidadeLegalParaGravar,
  linhaDoResponsavel,
} from "@/lib/identidade-legal-da-loja";

describe("formatarDocumento: a máscara no meio da digitação (só números, até 11: CPF)", () => {
  it.each([
    ["1", "1"],
    ["12", "12"],
    ["123", "123"],
    ["1234", "123.4"],
    ["12345", "123.45"],
    ["123456", "123.456"],
    ["1234567", "123.456.7"],
    ["12345678", "123.456.78"],
    ["123456789", "123.456.789"],
    ["1234567890", "123.456.789-0"],
    ["12345678901", "123.456.789-01"],
  ])("%s vira %s", (digitado, mascara) => {
    expect(formatarDocumento(digitado)).toBe(mascara);
  });

  it("CPF com zero no meio ainda é CPF (012.345.678-90)", () => {
    expect(formatarDocumento("01234567890")).toBe("012.345.678-90");
    expect(formatarDocumento("000")).toBe("000");
    expect(formatarDocumento("0000")).toBe("000.0");
  });
});

describe("formatarDocumento: letras ou mais de 11 números seguem a máscara de CNPJ", () => {
  it.each([
    ["A", "A"],
    ["A1", "A1"],
    ["A1B", "A1.B"],
    ["A1B2", "A1.B2"],
    ["A1B2C", "A1.B2C"],
    ["A1B2C3", "A1.B2C.3"],
    ["A1B2C3D", "A1.B2C.3D"],
    ["A1B2C3D4", "A1.B2C.3D4"],
    ["A1B2C3D4E", "A1.B2C.3D4/E"],
    ["A1B2C3D4E5", "A1.B2C.3D4/E5"],
    ["A1B2C3D4E5F", "A1.B2C.3D4/E5F"],
    ["A1B2C3D4E5F6", "A1.B2C.3D4/E5F6"],
    ["A1B2C3D4E5F6G", "A1.B2C.3D4/E5F6-G"],
    ["A1B2C3D4E5F6G7", "A1.B2C.3D4/E5F6-G7"],
  ])("%s vira %s", (digitado, mascara) => {
    expect(formatarDocumento(digitado)).toBe(mascara);
  });

  it.each([
    ["123456789012", "12.345.678/9012"],
    ["1234567890123", "12.345.678/9012-3"],
    ["12345678901234", "12.345.678/9012-34"],
  ])("12 a 14 números (%s) já é CNPJ: %s", (digitado, mascara) => {
    expect(formatarDocumento(digitado)).toBe(mascara);
  });

  it("letra minúscula sobe para maiúscula", () => {
    expect(formatarDocumento("ab")).toBe("AB");
    expect(formatarDocumento("ab1c2")).toBe("AB.1C2");
  });
});

describe("formatarDocumento: bordas", () => {
  it("vazio, só espaço e só pontuação viram texto vazio", () => {
    expect(formatarDocumento("")).toBe("");
    expect(formatarDocumento("   ")).toBe("");
    expect(formatarDocumento("./-")).toBe("");
    expect(formatarDocumento(null)).toBe("");
    expect(formatarDocumento(undefined)).toBe("");
  });

  it("já mascarado, com espaço nas pontas: refaz a máscara certa", () => {
    expect(formatarDocumento(" 123.456.789-01 ")).toBe("123.456.789-01");
    expect(formatarDocumento("11.222.333/0001-81")).toBe("11.222.333/0001-81");
  });

  it("passou de 14 caracteres: devolve tudo sem máscara, sem cortar", () => {
    expect(formatarDocumento("123456789012345")).toBe("123456789012345");
    expect(formatarDocumento("112.223.330/001-819")).toBe("112223330001819");
  });
});

describe("linhaDoResponsavel: só diz o que existe", () => {
  const completa = {
    razaoSocial: "Loja Modelo Ltda",
    tipoDoDocumento: "cnpj" as const,
    documento: "11.222.333/0001-81",
    email: "contato@lojamodelo.example",
  };

  it("com tudo: razão social, documento e contato", () => {
    expect(linhaDoResponsavel(completa)).toBe(
      "Responsável: Loja Modelo Ltda — CNPJ 11.222.333/0001-81 — contato: contato@lojamodelo.example",
    );
  });

  it("CPF diz CPF", () => {
    expect(
      linhaDoResponsavel({
        ...completa,
        tipoDoDocumento: "cpf",
        documento: "123.456.789-01",
        email: null,
      }),
    ).toBe("Responsável: Loja Modelo Ltda — CPF 123.456.789-01");
  });

  it("documento sem tipo não é citado (nada de 'CPF' chutado)", () => {
    expect(
      linhaDoResponsavel({
        ...completa,
        tipoDoDocumento: null,
        email: null,
      }),
    ).toBe("Responsável: Loja Modelo Ltda");
  });

  it("tipo sem documento não vira 'CNPJ null'", () => {
    expect(
      linhaDoResponsavel({ ...completa, documento: null, email: null }),
    ).toBe("Responsável: Loja Modelo Ltda");
  });

  it("sem razão social e sem documento não há responsável (só o e-mail não diz quem)", () => {
    expect(
      linhaDoResponsavel({
        razaoSocial: null,
        tipoDoDocumento: null,
        documento: null,
        email: "contato@lojamodelo.example",
      }),
    ).toBeNull();
    expect(linhaDoResponsavel(null)).toBeNull();
    expect(linhaDoResponsavel(undefined)).toBeNull();
  });
});

describe("identidadeLegalParaGravar: documento de qualquer tamanho que não confere é recusado", () => {
  const entrada = (documento: string) => ({
    razaoSocial: "",
    documento,
    email: "",
  });

  it.each(["5", "12", "123456", "11222333000180", "52998224726"])(
    "documento %j não confere: não grava",
    (documento) => {
      const resultado = identidadeLegalParaGravar(entrada(documento));

      expect(resultado.valido).toBe(false);
      expect(resultado.valido ? null : resultado.erros.documento).toBe(
        AVISO_DO_DOCUMENTO,
      );
    },
  );

  it("campo em branco é válido e vira null; CPF e CNPJ certos gravam só os caracteres", () => {
    expect(identidadeLegalParaGravar(entrada(""))).toEqual({
      valido: true,
      valores: {
        storeLegalName: null,
        storeLegalDocument: null,
        storeSupportEmail: null,
      },
    });
    expect(identidadeLegalParaGravar(entrada("529.982.247-25"))).toMatchObject({
      valido: true,
      valores: { storeLegalDocument: "52998224725" },
    });
    expect(
      identidadeLegalParaGravar(entrada("11.222.333/0001-81")),
    ).toMatchObject({
      valido: true,
      valores: { storeLegalDocument: "11222333000181" },
    });
  });
});

describe("identidadeLegalDaLoja: config ausente ou vazia", () => {
  it("sem config, a loja não declara identidade (null, não undefined)", () => {
    expect(identidadeLegalDaLoja(null)).toBeNull();
    expect(identidadeLegalDaLoja(undefined)).toBeNull();
  });
});
