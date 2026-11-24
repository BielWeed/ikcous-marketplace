import { describe, expect, it } from "vitest";

import {
  dataEscolhidaParaValidade,
  validadeParaDataDoInput,
} from "@/utils/validade-do-cupom";

// Caça por mutação em `validade-do-cupom.ts`. O teste vizinho
// (`validade-do-cupom.test.ts`) prova o fuso e o fim do dia, mas deixava passar:
//   - as âncoras `^` e `$` da conferência do formato: texto com sobra ("2026-03-10-05",
//     "2026-03-10 ") ou com ano de 5 dígitos ("12026-03-10", que um campo de data
//     aceita digitando) virava uma validade "válida" em vez de "sem validade";
//   - o zero à esquerda do ano na volta: ano com menos de 4 dígitos saía
//     "99-05-10" e o campo de data não reconhece isso.
// Aritmética pura em UTC, sem depender do fuso da máquina.

describe("dataEscolhidaParaValidade — só aceita exatamente AAAA-MM-DD", () => {
  it("controle: o formato exato vira o fim do dia de Brasília", () => {
    expect(dataEscolhidaParaValidade("2026-03-10")).toBe(
      "2026-03-11T02:59:59.999Z",
    );
  });

  it("sobra depois da data não vira validade", () => {
    expect(dataEscolhidaParaValidade("2026-03-10-05")).toBeUndefined();
    expect(dataEscolhidaParaValidade("2026-03-10 ")).toBeUndefined();
    expect(dataEscolhidaParaValidade("2026-03-10T00:00")).toBeUndefined();
  });

  it("sobra antes da data (ano de 5 dígitos) não vira validade", () => {
    expect(dataEscolhidaParaValidade("12026-03-10")).toBeUndefined();
    expect(dataEscolhidaParaValidade(" 2026-03-10")).toBeUndefined();
  });
});

describe("validadeParaDataDoInput — o ano sempre com 4 dígitos", () => {
  it("ano antes de 1000 mantém o zero à esquerda", () => {
    expect(validadeParaDataDoInput("0099-05-10T12:00:00.000Z")).toBe(
      "0099-05-10",
    );
  });

  it("controle: ano comum", () => {
    expect(validadeParaDataDoInput("2026-05-10T12:00:00.000Z")).toBe(
      "2026-05-10",
    );
  });
});
