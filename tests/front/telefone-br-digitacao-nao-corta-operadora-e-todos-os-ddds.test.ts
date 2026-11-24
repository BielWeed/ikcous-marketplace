// O que este teste protege, na régua de WhatsApp do perfil/checkout
// (`@/lib/telefone-br`):
//  - "0 + operadora" na frente só é cortado na COLAGEM; na digitação tecla a
//    tecla o número fica como foi digitado (cortar dois dígitos no meio da
//    digitação trocaria o DDD da pessoa);
//  - um "+55" com espaço antes continua sendo reconhecido como código do país;
//  - número que vem de fora, sem valor anterior (`mascaraWhatsappBr(novo)`),
//    conta como colagem e perde o "55" do país;
//  - TODOS os DDDs do Brasil são aceitos e os que não existem são recusados —
//    antes, esquecer um DDD da lista passava sem teste, e a cliente daquele
//    estado não conseguia salvar o próprio WhatsApp.
import { describe, expect, it } from "vitest";

import {
  celularBrasileiroCompleto,
  dddBrasileiroValido,
  digitosDoTelefoneDoCampo,
  limparTelefoneBrasileiro,
  mascaraWhatsappBr,
} from "@/lib/telefone-br";

// Lista oficial da Anatel (67 códigos), escrita aqui de forma independente.
const DDDS_DO_BRASIL = (
  "11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 " +
  "41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 " +
  "71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99"
).split(" ");

const DDDS_QUE_NAO_EXISTEM =
  "10 20 23 25 26 29 30 36 39 40 50 52 56 57 58 59 60 70 72 76 78 80 90 00".split(
    " ",
  );

describe("limparTelefoneBrasileiro — operadora só some na colagem", () => {
  it("colando '014 34 99999-1234' corta o 0 e a operadora", () => {
    expect(limparTelefoneBrasileiro("014 34 99999-1234")).toBe("34999991234");
  });

  it("digitando o mesmo texto (colagem: false) só tira o zero de tronco", () => {
    expect(
      limparTelefoneBrasileiro("014 34 99999-1234", { colagem: false }),
    ).toBe("1434999991234");
  });
});

describe("limparTelefoneBrasileiro — '+55' com espaço antes", () => {
  it("reconhece o código do país mesmo com espaço no começo", () => {
    expect(limparTelefoneBrasileiro(" +55 34 99")).toBe("3499");
  });
});

describe("número que vem de fora, sem valor anterior", () => {
  it("digitosDoTelefoneDoCampo sem anterior trata como colagem e tira o 55", () => {
    expect(digitosDoTelefoneDoCampo("5534999991234")).toBe("34999991234");
  });

  it("mascaraWhatsappBr sem anterior formata o número sem o 55 do país", () => {
    expect(mascaraWhatsappBr("5534999991234")).toBe("(34) 99999-1234");
  });

  it("com anterior vazio e uma tecla só, o 55 inicial é DDD de verdade", () => {
    expect(mascaraWhatsappBr("5", "")).toBe("5");
    expect(digitosDoTelefoneDoCampo("55", "5")).toBe("55");
  });
});

describe("DDDs do Brasil", () => {
  it("a lista de referência tem os 67 códigos", () => {
    expect(new Set(DDDS_DO_BRASIL).size).toBe(67);
  });

  it.each(DDDS_DO_BRASIL)("aceita o DDD %s num celular completo", (ddd) => {
    expect(dddBrasileiroValido(`${ddd}999991234`)).toBe(true);
    expect(celularBrasileiroCompleto(`(${ddd}) 99999-1234`)).toBe(true);
  });

  it.each(DDDS_QUE_NAO_EXISTEM)("recusa o DDD %s, que não existe", (ddd) => {
    expect(dddBrasileiroValido(`${ddd}999991234`)).toBe(false);
    expect(celularBrasileiroCompleto(`(${ddd}) 99999-1234`)).toBe(false);
  });
});
