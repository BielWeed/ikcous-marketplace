// Colar " SP " no campo de UF: o navegador, com `maxLength={2}`, cortava o texto
// colado ANTES de qualquer limpeza e guardava " S" -- a cliente recebia "Estado
// inválido" por ter copiado uma UF válida. `normalizarUf` limpa uma sigla
// com espaços sem cortar nomes ou outras entradas.

import { normalizarUf, ufBrasileiraValida } from "@/lib/uf-brasileira";
import { describe, expect, it } from "vitest";

describe("normalizarUf", () => {
  it.each([
    [" sp ", "SP"],
    ["SP ", "SP"],
    [" SP", "SP"],
    ["s p", "SP"],
    ["\tmg\n", "MG"],
  ])("colar %j resulta em %j", (colado, esperado) => {
    expect(normalizarUf(colado)).toBe(esperado);
  });

  it("quem digita normalmente não sente diferença", () => {
    expect(normalizarUf("")).toBe("");
    expect(normalizarUf("m")).toBe("M");
    expect(normalizarUf("mg")).toBe("MG");
    expect(normalizarUf("RJ")).toBe("RJ");
  });

  it.each([
    ["Acre", "AC"],
    ["Alagoas", "AL"],
    ["Amapá", "AP"],
    ["Amazonas", "AM"],
    ["Bahia", "BA"],
    ["Ceará", "CE"],
    ["Distrito Federal", "DF"],
    ["Espírito Santo", "ES"],
    ["Goiás", "GO"],
    ["Maranhão", "MA"],
    ["Mato Grosso", "MT"],
    ["Mato Grosso do Sul", "MS"],
    ["Minas Gerais", "MG"],
    ["Pará", "PA"],
    ["Paraíba", "PB"],
    ["Paraná", "PR"],
    ["Pernambuco", "PE"],
    ["Piauí", "PI"],
    ["Rio de Janeiro", "RJ"],
    ["Rio Grande do Norte", "RN"],
    ["Rio Grande do Sul", "RS"],
    ["Rondônia", "RO"],
    ["Roraima", "RR"],
    ["Santa Catarina", "SC"],
    ["São Paulo", "SP"],
    ["Sergipe", "SE"],
    ["Tocantins", "TO"],
  ])("converte o nome completo %s em %s", (nome, sigla) => {
    expect(normalizarUf(nome)).toBe(sigla);
    const semAcentos = nome.normalize("NFD").replace(/\p{M}/gu, "");
    expect(normalizarUf(`  ${semAcentos.toLowerCase()}  `)).toBe(sigla);
    expect(normalizarUf(nome.toUpperCase())).toBe(sigla);
  });

  it.each(["Mato Grosso do Xul", "mgx", "sp123", "  s  p  x"])(
    "mantém %j para correção sem transformá-lo em uma UF válida",
    (texto) => {
      const resultado = normalizarUf(texto);
      expect(resultado).toBe(texto);
      expect(ufBrasileiraValida(resultado)).toBe(false);
    },
  );

  it("trata só espaços como vazio", () => {
    expect(normalizarUf(" \t ")).toBe("");
  });

  it("o resultado de uma UF colada com espaço é uma UF válida", () => {
    expect(ufBrasileiraValida(normalizarUf(" sp "))).toBe(true);
  });
});
