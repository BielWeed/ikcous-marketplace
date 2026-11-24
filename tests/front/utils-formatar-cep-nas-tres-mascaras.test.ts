import { formatarCep as formatarCepDigitando } from "@/hooks/useBuscaCep";
// Caça por mutação nas três máscaras de CEP do app (digitação do endereço,
// endereço já gravado e CEP da loja). Cada uma tem a sua regra de fronteira e
// a diferença entre elas é de propósito:
//   - `formatarCep` (useBuscaCep): máscara enquanto digita; passa de 5
//     dígitos ganha o hífen; corta o hífen em 8 dígitos, sem cortar o resto.
//   - `formatarCep` (endereco-de-entrega): valor GRAVADO; só formata se tem
//     exatamente 8 dígitos, senão devolve o texto como veio.
//   - `formatarCepDaLoja`: máscara parcial; corta em 8 dígitos.
// Só CEPs fictícios.
import { formatarCepDaLoja } from "@/lib/endereco-da-loja";
import { formatarCep as formatarCepGravado } from "@/lib/endereco-de-entrega";
import { describe, expect, it } from "vitest";

describe("formatarCep de digitação (useBuscaCep)", () => {
  it.each([
    ["", "", ""],
    ["3", "3", "3"],
    ["38500", "38500", "38500"], // 5 dígitos: ainda sem hífen
    ["385001", "385001", "38500-1"], // o 6º dígito abre o hífen
    ["38500123", "38500123", "38500-123"],
    ["38.500-123", "38500123", "38500-123"], // colado com máscara
    ["CEP 38500123", "38500123", "38500-123"],
  ])("%j → limpo %j, formatado %j", (bruto, limpo, formatado) => {
    expect(formatarCepDigitando(bruto)).toEqual({ limpo, formatado });
  });

  it("dígito a mais (9º) não é engolido no `limpo`, e a máscara não o mostra", () => {
    // O chamador compara `limpo` com 8 para validar: 9 dígitos reprova.
    const campo = formatarCepDigitando("385001234");
    expect(campo.limpo).toBe("385001234");
    expect(campo.formatado).toBe("38500-123");
  });
});

describe("formatarCep de endereço gravado (endereco-de-entrega)", () => {
  it("8 dígitos, com ou sem máscara, saem como 00000-000", () => {
    expect(formatarCepGravado("38500123")).toBe("38500-123");
    expect(formatarCepGravado("38500-123")).toBe("38500-123");
    expect(formatarCepGravado(" 38.500-123 ")).toBe("38500-123");
  });

  it("7 ou 9 dígitos NÃO são formatados: o texto volta como veio", () => {
    expect(formatarCepGravado("3850012")).toBe("3850012");
    expect(formatarCepGravado("385001234")).toBe("385001234");
  });

  it("vazio, nulo e ausente viram texto vazio, nunca 'null'", () => {
    expect(formatarCepGravado("")).toBe("");
    expect(formatarCepGravado(null)).toBe("");
    expect(formatarCepGravado(undefined)).toBe("");
  });
});

describe("formatarCepDaLoja", () => {
  it.each([
    ["", ""],
    ["385", "385"], // parcial fica parcial
    ["38500", "38500"], // 5 dígitos: sem hífen
    ["385001", "38500-1"],
    ["38500123", "38500-123"],
    ["38500-123", "38500-123"],
  ])("%j → %j", (bruto, esperado) => {
    expect(formatarCepDaLoja(bruto)).toBe(esperado);
  });

  it("passou de 8 dígitos: o excedente é cortado (a loja só grava 8)", () => {
    expect(formatarCepDaLoja("385001239999")).toBe("38500-123");
  });

  it("nulo e ausente viram vazio", () => {
    expect(formatarCepDaLoja(null)).toBe("");
    expect(formatarCepDaLoja(undefined)).toBe("");
  });
});
