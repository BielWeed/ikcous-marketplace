// A faixa de CEP da entrega local, escrita no painel (Ajustes > Frete), tem uma
// pegadinha que o aviso do painel existe para mostrar: DOIS CEPs completos
// ("38500-000, 38599-999") valem como começo e fim de uma faixa, mas basta a
// lojista acrescentar um terceiro item e os dois primeiros deixam de ser faixa:
// viram CEPs avulsos, e quem mora entre eles perde a entrega local. As regras
// abaixo são do banco (`is_local_cep`) e da edge de cotação; a tela só avisa.
import {
  cepEhLocal,
  erroDaFaixaDeCepLocal,
  perdeIntervaloDeCepLocal,
} from "@/lib/cep-local";
import { describe, expect, it } from "vitest";

describe("o aviso 'o intervalo se perdeu' (perdeIntervaloDeCepLocal)", () => {
  it.each([
    ["três CEPs completos com hífen", "38500-000, 38599-999, 38700-000"],
    ["três CEPs completos sem hífen", "38500000, 38599999, 38700000"],
    [
      "mais de três, os dois primeiros completos",
      "38500-000, 38599-999, 38700-000, 38800-000",
    ],
    ["o terceiro item é só um prefixo curto", "38500-000, 38599-999, 385"],
  ])("avisa quando é %s", (_nome, faixa) => {
    expect(perdeIntervaloDeCepLocal(faixa)).toBe(true);
  });

  it.each([
    ["vazio", ""],
    ["só separadores", ", ,"],
    ["um CEP só", "38500-000"],
    ["dois CEPs completos: aí o intervalo VALE", "38500-000, 38599-999"],
    [
      "dois CEPs e um terceiro item vazio: o vazio não conta",
      "38500-000, 38599-999, ",
    ],
    ["vírgula sobrando no começo", ", 38500-000, 38599-999"],
    [
      "o primeiro item já é uma faixa escrita (dois blocos longos)",
      "38500000-38599999, 38700-000, 38800-000",
    ],
    [
      "o segundo item é uma faixa escrita",
      "38500-000, 38500000-38599999, 38700-000",
    ],
    [
      "o segundo item é prefixo de 5 dígitos, não um CEP completo",
      "38500-000, 38599, 38700-000",
    ],
    ["o segundo item tem 7 dígitos", "38500-000, 3850012, 38700-000"],
    [
      "o segundo item tem 9 dígitos (a mais)",
      "38500-000, 385000011, 38700-000",
    ],
  ])("não avisa quando: %s", (_nome, faixa) => {
    expect(perdeIntervaloDeCepLocal(faixa)).toBe(false);
  });
});

describe("por que o aviso existe: o que o terceiro item faz com os dois primeiros", () => {
  const ORIGEM = "38500-000";
  const ENTRE_OS_DOIS = "38550-000";

  it("com dois CEPs completos, quem mora entre eles tem entrega local", () => {
    expect(cepEhLocal(ORIGEM, ENTRE_OS_DOIS, "38500-000, 38599-999")).toBe(
      true,
    );
  });

  it("com um terceiro item, os dois primeiros viram CEPs avulsos e o do meio perde", () => {
    expect(
      cepEhLocal(ORIGEM, ENTRE_OS_DOIS, "38500-000, 38599-999, 38700-000"),
    ).toBe(false);
    // Os avulsos continuam valendo, cada um por si.
    expect(
      cepEhLocal(ORIGEM, "38599-999", "38500-000, 38599-999, 38700-000"),
    ).toBe(true);
  });
});

describe("o que NÃO é faixa de CEP: três blocos, ou bloco de 5 dígitos", () => {
  // O banco só lê como faixa DOIS blocos, cada um com 6+ dígitos.
  it("três blocos longos não formam uma faixa", () => {
    expect(cepEhLocal("38500000", "38500050", "385000-385001-385002")).toBe(
      false,
    );
  });

  it("um bloco de 5 dígitos antes de um longo não forma uma faixa", () => {
    expect(cepEhLocal("38500000", "38500100", "38500-385050")).toBe(false);
  });

  it("um bloco longo antes de um de 5 dígitos não forma uma faixa", () => {
    expect(cepEhLocal("38500000", "38500100", "385000-38505")).toBe(false);
  });

  it("dois blocos de 6 dígitos formam a faixa, e as pontas valem", () => {
    expect(cepEhLocal("38500000", "38500000", "385000-385050")).toBe(true);
    expect(cepEhLocal("38500000", "38505099", "385000-385050")).toBe(true);
    expect(cepEhLocal("38500000", "38505100", "385000-385050")).toBe(false);
  });
});

describe("erroDaFaixaDeCepLocal: dois CEPs colados sem vírgula, ou CEP com dígito demais", () => {
  it("dois CEPs de 8 dígitos separados só por espaço: falta a vírgula", () => {
    expect(erroDaFaixaDeCepLocal("38500000 38599999")).toBe("separador");
  });

  it.each([
    ["um CEP de 8 e outro de 9 dígitos", "38500000 385999999"],
    ["os dois de 9 dígitos", "385000001 385999999"],
    ["o primeiro de 9 e o segundo de 8", "385000001 38599999"],
  ])("%s: o problema é dígito a mais, não a vírgula", (_nome, faixa) => {
    expect(erroDaFaixaDeCepLocal(faixa)).toBe("digitos-demais");
  });

  it("um CEP só com dígito a mais não tem vírgula para sugerir", () => {
    expect(erroDaFaixaDeCepLocal("385000001")).toBe("digitos-demais");
  });
});

describe("destino curto, faixa com mistura e prefixo de 7 dígitos", () => {
  it("destino curto vale pelo começo da faixa (completa com zeros, como o banco)", () => {
    expect(cepEhLocal("38500000", "385", "38500000-38505000")).toBe(true);
    expect(cepEhLocal("38500000", "38505", "38500000-38505000")).toBe(true);
    expect(cepEhLocal("38500000", "386", "38500000-38505000")).toBe(false);
  });

  it("uma faixa escrita por extenso junto de dois CEPs: os dois CEPs NÃO viram faixa", () => {
    const faixa = "38500000-38505000, 38700-000, 38799-999";
    expect(cepEhLocal("38500000", "38503000", faixa)).toBe(true);
    expect(cepEhLocal("38500000", "38750000", faixa)).toBe(false);
    expect(cepEhLocal("38500000", "38799999", faixa)).toBe(true);
  });

  it("dois CEPs completos em qualquer ordem formam a mesma faixa", () => {
    expect(cepEhLocal("38500000", "38550000", "38599-999, 38500-000")).toBe(
      true,
    );
    expect(cepEhLocal("38500000", "38550000", "38500-000, 38599-999")).toBe(
      true,
    );
    expect(cepEhLocal("38500000", "38600000", "38599-999, 38500-000")).toBe(
      false,
    );
  });

  it("prefixo de 7 dígitos casa pelo começo do CEP, não só o CEP inteiro", () => {
    expect(cepEhLocal("38500000", "38500123", "3850012")).toBe(true);
    expect(cepEhLocal("38500000", "38500223", "3850012")).toBe(false);
  });
});
