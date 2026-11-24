// O WhatsApp da loja e o da cliente passam por três regras de telefone que, se
// erradas, trocam o número em silêncio: a lista de DDDs do Brasil (um DDD que
// não existe vira "válido"), a tecla extra no fim de um celular completo (some,
// de propósito) e o par de dígitos COLADO no fim (tem de ficar visível para a
// validação reprovar, nunca virar outro celular válido). Os outros arquivos
// `telefone-br-*` cobrem zero na frente, "+55" e o celular completo.
import {
  celularBrasileiroCompleto,
  dddBrasileiroValido,
  mascaraTelefoneDoCadastro,
  mascaraWhatsappBr,
  mensagemDeWhatsappIncompleto,
} from "@/lib/telefone-br";
import { describe, expect, it } from "vitest";

// Os 67 códigos de área em uso no Brasil (Anatel), escritos aqui por
// extenso e de forma independente da lista do código.
const DDDS_DO_BRASIL = [
  ...[11, 12, 13, 14, 15, 16, 17, 18, 19],
  ...[21, 22, 24, 27, 28],
  ...[31, 32, 33, 34, 35, 37, 38],
  ...[41, 42, 43, 44, 45, 46, 47, 48, 49],
  ...[51, 53, 54, 55],
  ...[61, 62, 63, 64, 65, 66, 67, 68, 69],
  ...[71, 73, 74, 75, 77, 79],
  ...[81, 82, 83, 84, 85, 86, 87, 88, 89],
  ...[91, 92, 93, 94, 95, 96, 97, 98, 99],
].map(String);

describe("dddBrasileiroValido — a lista inteira, nem um a mais nem um a menos", () => {
  it("tem 67 códigos e todos são aceitos", () => {
    expect(DDDS_DO_BRASIL).toHaveLength(67);
    for (const ddd of DDDS_DO_BRASIL) {
      expect(dddBrasileiroValido(`${ddd}987654321`), `DDD ${ddd}`).toBe(true);
    }
  });

  it("todo código de 00 a 99 que NÃO está na lista é recusado", () => {
    for (let n = 0; n <= 99; n++) {
      const ddd = String(n).padStart(2, "0");
      if (DDDS_DO_BRASIL.includes(ddd)) continue;
      expect(dddBrasileiroValido(`${ddd}987654321`), `DDD ${ddd}`).toBe(false);
    }
  });

  it("DDD que não existe reprova o celular e a mensagem do erro diz 'DDD inválido'", () => {
    expect(celularBrasileiroCompleto("10987654321")).toBe(false);
    expect(celularBrasileiroCompleto("(23) 98765-4321")).toBe(false);
    expect(mensagemDeWhatsappIncompleto("10987654321")).toBe(
      "Confira o WhatsApp: DDD inválido",
    );
  });
});

describe("máscaras nos pontos de corte (2, 3, 7 e 8 dígitos)", () => {
  // Quem digita tecla a tecla passa por cada um destes tamanhos; um corte
  // deslocado em um dígito mostra parêntese vazio ou hífen fora do lugar.
  const passos: ReadonlyArray<readonly [string, string]> = [
    ["1", "1"],
    ["11", "11"],
    ["119", "(11) 9"],
    ["1198", "(11) 98"],
    ["11987", "(11) 987"],
    ["119876", "(11) 9876"],
    ["1198765", "(11) 98765"],
    ["11987654", "(11) 98765-4"],
    ["11987654321", "(11) 98765-4321"],
  ];

  it.each(passos)("WhatsApp: %j vira %j", (digitos, esperado) => {
    expect(mascaraWhatsappBr(digitos)).toBe(esperado);
  });

  it.each(passos)("cadastro: %j vira %j", (digitos, esperado) => {
    expect(mascaraTelefoneDoCadastro(digitos)).toBe(esperado);
  });
});

describe("cadastro: número estrangeiro acima de 11 dígitos (corte em 15 caracteres)", () => {
  it("cabe em 15 caracteres: o texto fica como foi colado", () => {
    expect(mascaraTelefoneDoCadastro("+44 7911 123456")).toBe(
      "+44 7911 123456",
    );
  });

  it("o corte tiraria só espaço: corta no 15º caractere", () => {
    expect(mascaraTelefoneDoCadastro("+44 7911 123456 ")).toBe(
      "+44 7911 123456",
    );
  });

  it("o corte levaria um dígito embora: ficam os dígitos, para a validação reprovar", () => {
    expect(mascaraTelefoneDoCadastro("+44 7911 1234567")).toBe("4479111234567");
  });
});

describe("tecla extra no fim de um celular completo x dígitos colados no fim", () => {
  it("UMA tecla extra no fim do número completo é ignorada (o número na tela não muda)", () => {
    expect(mascaraWhatsappBr("(11) 98765-43219", "(11) 98765-4321")).toBe(
      "(11) 98765-4321",
    );
    expect(
      mascaraTelefoneDoCadastro("(11) 98765-43219", "(11) 98765-4321"),
    ).toBe("(11) 98765-4321");
  });

  it("DOIS dígitos colados no fim ficam VISÍVEIS depois do hífen, e o número não vale mais", () => {
    const colado = "(11) 98765-4321 99";
    const mascarado = mascaraWhatsappBr(colado, "(11) 98765-4321");
    expect(mascarado).toBe("(11) 98765-432199");
    expect(celularBrasileiroCompleto(mascarado)).toBe(false);
  });

  it("no cadastro, dígitos colados no fim também ficam visíveis em vez de sumir", () => {
    const resultado = mascaraTelefoneDoCadastro(
      "(11) 98765-4321 99",
      "(11) 98765-4321",
    );
    expect(resultado.replace(/\D/g, "")).toBe("1198765432199");
    expect(celularBrasileiroCompleto(resultado)).toBe(false);
  });

  it("uma tecla extra digitada no MEIO não é tratada como tecla extra no fim", () => {
    // Digitou um 9 depois do DDD: 12 dígitos que não começam pelo número antigo.
    const resultado = mascaraWhatsappBr("(11) 998765-4321", "(11) 98765-4321");
    expect(resultado.replace(/\D/g, "")).toBe("119987654321");
    expect(celularBrasileiroCompleto(resultado)).toBe(false);
  });
});
