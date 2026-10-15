// A loja pode dizer QUEM é (razão social, CNPJ ou CPF) e por onde falar
// (e-mail de atendimento), de forma opcional. Estas são as regras puras:
// o documento só vale com o dígito verificador certo, o e-mail só com forma de
// e-mail, o que está em branco vira "não disse" (null) e a linha que a cliente
// lê só junta o que existe. Nada aqui toca banco nem tela.
import { describe, expect, it } from "vitest";

import {
  type IdentidadeLegalDaLoja,
  documentoValido,
  emailDeAtendimentoValido,
  formatarDocumento,
  identidadeLegalDaLoja,
  identidadeLegalParaGravar,
  linhaDoResponsavel,
} from "@/lib/identidade-legal-da-loja";

describe("documentoValido — CPF e CNPJ pelo dígito verificador", () => {
  it.each([
    ["529.982.247-25", "cpf"],
    ["52998224725", "cpf"],
    ["11.222.333/0001-81", "cnpj"],
    ["11222333000181", "cnpj"],
    // O exemplo OFICIAL da Receita para o CNPJ alfanumérico (valido desde
    // julho de 2026): base 12ABC34501DE, verificadores 35.
    ["12.ABC.345/01DE-35", "cnpj"],
    ["12abc34501de35", "cnpj"],
  ])("aceita %s como %s", (valor, tipo) => {
    expect(documentoValido(valor)).toBe(tipo);
  });

  it.each([
    ["CPF com o último dígito errado", "529.982.247-24"],
    ["CNPJ com o último dígito errado", "11.222.333/0001-82"],
    ["CNPJ alfanumérico com verificador errado", "12.ABC.345/01DE-36"],
    ["CPF de dígito repetido", "111.111.111-11"],
    ["CNPJ de dígito repetido", "00.000.000/0000-00"],
    ["curto demais", "1234567890"],
    ["12 caracteres", "112223330001"],
    ["comprido demais", "112223330001811"],
    ["só letras", "ABCDEFGHIJKLMN"],
    ["vazio", ""],
    ["espaços", "   "],
  ])("recusa %s", (_nome, valor) => {
    expect(documentoValido(valor)).toBeNull();
  });

  it("os dois dígitos verificadores contam: trocar qualquer um reprova", () => {
    expect(documentoValido("52998224715")).toBeNull();
    expect(documentoValido("52998224725")).toBe("cpf");
    expect(documentoValido("11222333000171")).toBeNull();
    expect(documentoValido("11222333000181")).toBe("cnpj");
  });

  it("letra no meio de um CPF não vale (CPF é só número)", () => {
    expect(documentoValido("5299822472A")).toBeNull();
  });
});

describe("formatarDocumento — máscara para mostrar", () => {
  it("CPF", () =>
    expect(formatarDocumento("52998224725")).toBe("529.982.247-25"));
  it("CNPJ", () =>
    expect(formatarDocumento("11222333000181")).toBe("11.222.333/0001-81"));
  it("CNPJ alfanumérico, em maiúsculas", () =>
    expect(formatarDocumento("12abc34501de35")).toBe("12.ABC.345/01DE-35"));
  it("no meio da digitação, mascara o que já tem (até 11 dígitos é CPF; passou disso, CNPJ)", () => {
    expect(formatarDocumento("5299")).toBe("529.9");
    expect(formatarDocumento("112223")).toBe("112.223");
    expect(formatarDocumento("1122233300018")).toBe("11.222.333/0001-8");
    expect(formatarDocumento("12ABC")).toBe("12.ABC");
  });
  it("vazio continua vazio", () => expect(formatarDocumento("")).toBe(""));
});

describe("emailDeAtendimentoValido", () => {
  it.each(["atendimento@loja.com.br", "a@b.co", "oi+loja@dominio.com"])(
    "aceita %s",
    (e) => expect(emailDeAtendimentoValido(e)).toBe(true),
  );
  it("o limite é 254 caracteres, o mesmo da CHECK do banco", () => {
    expect(emailDeAtendimentoValido(`${"a".repeat(248)}@b.com`)).toBe(true);
    expect(emailDeAtendimentoValido(`${"a".repeat(249)}@b.com`)).toBe(false);
  });
  it.each([
    "sem-arroba.com",
    "a@b",
    "a@@b.com",
    "a b@c.com",
    "@b.com",
    "a@.com",
    "",
    `${"a".repeat(250)}@b.com`,
  ])("recusa %j", (e) => expect(emailDeAtendimentoValido(e)).toBe(false));
});

describe("identidadeLegalParaGravar — o que vai ao banco", () => {
  it("tudo em branco é válido e grava null (a loja não disse)", () => {
    expect(
      identidadeLegalParaGravar({ razaoSocial: "", documento: "", email: "" }),
    ).toEqual({
      valido: true,
      valores: {
        storeLegalName: null,
        storeLegalDocument: null,
        storeSupportEmail: null,
      },
    });
    expect(
      identidadeLegalParaGravar({
        razaoSocial: "   ",
        documento: " ",
        email: "  ",
      }),
    ).toMatchObject({ valido: true });
  });

  it("preenchido grava limpo: nome aparado, documento sem máscara, e-mail aparado", () => {
    expect(
      identidadeLegalParaGravar({
        razaoSocial: "  Loja da Ana   Ltda ",
        documento: "11.222.333/0001-81",
        email: " Atendimento@Loja.com.br ",
      }),
    ).toEqual({
      valido: true,
      valores: {
        storeLegalName: "Loja da Ana Ltda",
        storeLegalDocument: "11222333000181",
        storeSupportEmail: "Atendimento@Loja.com.br",
      },
    });
  });

  it("CNPJ alfanumérico grava em maiúsculas", () => {
    expect(
      identidadeLegalParaGravar({
        razaoSocial: "",
        documento: "12.abc.345/01de-35",
        email: "",
      }),
    ).toMatchObject({
      valido: true,
      valores: { storeLegalDocument: "12ABC34501DE35" },
    });
  });

  it("documento inválido NÃO grava e diz o motivo em português simples", () => {
    const r = identidadeLegalParaGravar({
      razaoSocial: "Loja",
      documento: "11.222.333/0001-82",
      email: "",
    });
    expect(r.valido).toBe(false);
    if (!r.valido) {
      expect(r.erros.documento).toMatch(/CNPJ|CPF/);
      expect(r.erros.razaoSocial).toBeUndefined();
      expect(r.erros.email).toBeUndefined();
    }
  });

  it("e-mail inválido NÃO grava", () => {
    const r = identidadeLegalParaGravar({
      razaoSocial: "",
      documento: "",
      email: "isso-nao-e-email",
    });
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.erros.email).toMatch(/e-mail/i);
  });

  it("razão social comprida demais NÃO grava (limite do banco: 200)", () => {
    const r = identidadeLegalParaGravar({
      razaoSocial: "x".repeat(201),
      documento: "",
      email: "",
    });
    expect(r.valido).toBe(false);
    if (!r.valido) expect(r.erros.razaoSocial).toBeDefined();
    expect(
      identidadeLegalParaGravar({
        razaoSocial: "x".repeat(200),
        documento: "",
        email: "",
      }).valido,
    ).toBe(true);
  });

  it("todos os erros vêm juntos (a lojista corrige de uma vez)", () => {
    const r = identidadeLegalParaGravar({
      razaoSocial: "x".repeat(201),
      documento: "123",
      email: "x",
    });
    expect(r.valido).toBe(false);
    if (!r.valido)
      expect(Object.keys(r.erros).sort()).toEqual([
        "documento",
        "email",
        "razaoSocial",
      ]);
  });
});

describe("identidadeLegalDaLoja — o que a vitrine lê do config", () => {
  it("config sem nada preenchido = null (nada muda para ninguém)", () => {
    expect(identidadeLegalDaLoja({})).toBeNull();
    expect(
      identidadeLegalDaLoja({
        storeLegalName: null,
        storeLegalDocument: null,
        storeSupportEmail: null,
      }),
    ).toBeNull();
    expect(
      identidadeLegalDaLoja({
        storeLegalName: "   ",
        storeLegalDocument: "",
        storeSupportEmail: " ",
      }),
    ).toBeNull();
  });

  it("devolve o que existe, com o documento já formatado e tipado", () => {
    expect(
      identidadeLegalDaLoja({
        storeLegalName: " Loja da Ana Ltda ",
        storeLegalDocument: "11222333000181",
        storeSupportEmail: "oi@loja.com",
      }),
    ).toEqual<IdentidadeLegalDaLoja>({
      razaoSocial: "Loja da Ana Ltda",
      tipoDoDocumento: "cnpj",
      documento: "11.222.333/0001-81",
      email: "oi@loja.com",
    });
  });

  it("só o e-mail também conta", () => {
    expect(identidadeLegalDaLoja({ storeSupportEmail: "oi@loja.com" })).toEqual(
      {
        razaoSocial: null,
        tipoDoDocumento: null,
        documento: null,
        email: "oi@loja.com",
      },
    );
  });

  it("documento gravado por fora com dígito errado NÃO é mostrado (nunca mostra um CNPJ que não existe)", () => {
    expect(
      identidadeLegalDaLoja({
        storeLegalName: "Loja",
        storeLegalDocument: "11222333000182",
      }),
    ).toEqual({
      razaoSocial: "Loja",
      tipoDoDocumento: null,
      documento: null,
      email: null,
    });
  });

  it("e-mail gravado por fora sem forma de e-mail NÃO é mostrado", () => {
    expect(
      identidadeLegalDaLoja({ storeSupportEmail: "lixo", storeLegalName: "L" }),
    ).toMatchObject({ email: null });
  });
});

describe("linhaDoResponsavel — a frase que a cliente lê", () => {
  const completa: IdentidadeLegalDaLoja = {
    razaoSocial: "Loja da Ana Ltda",
    tipoDoDocumento: "cnpj",
    documento: "11.222.333/0001-81",
    email: "oi@loja.com",
  };

  it("completa", () => {
    expect(linhaDoResponsavel(completa)).toBe(
      "Responsável: Loja da Ana Ltda — CNPJ 11.222.333/0001-81 — contato: oi@loja.com",
    );
  });

  it("CPF diz CPF", () => {
    expect(
      linhaDoResponsavel({
        ...completa,
        tipoDoDocumento: "cpf",
        documento: "529.982.247-25",
      }),
    ).toBe(
      "Responsável: Loja da Ana Ltda — CPF 529.982.247-25 — contato: oi@loja.com",
    );
  });

  it("só junta o que existe", () => {
    expect(linhaDoResponsavel({ ...completa, email: null })).toBe(
      "Responsável: Loja da Ana Ltda — CNPJ 11.222.333/0001-81",
    );
    expect(
      linhaDoResponsavel({
        ...completa,
        documento: null,
        tipoDoDocumento: null,
      }),
    ).toBe("Responsável: Loja da Ana Ltda — contato: oi@loja.com");
    expect(
      linhaDoResponsavel({
        razaoSocial: null,
        tipoDoDocumento: "cnpj",
        documento: "11.222.333/0001-81",
        email: null,
      }),
    ).toBe("Responsável: CNPJ 11.222.333/0001-81");
  });

  it("sem razão social e sem documento não há responsável a declarar (só e-mail não é 'responsável')", () => {
    expect(
      linhaDoResponsavel({
        razaoSocial: null,
        tipoDoDocumento: null,
        documento: null,
        email: "oi@loja.com",
      }),
    ).toBeNull();
    expect(linhaDoResponsavel(null)).toBeNull();
  });
});
