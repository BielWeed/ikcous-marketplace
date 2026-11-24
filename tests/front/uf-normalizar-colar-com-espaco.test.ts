// Colar " SP " no campo de UF: o navegador, com `maxLength={2}`, cortava o texto
// colado ANTES de qualquer limpeza e guardava " S" -- a cliente recebia "Estado
// inválido" por ter copiado uma UF válida. `normalizarUf` limpa uma sigla
// com espaços sem cortar nomes ou outras entradas.

import {
  normalizarUf,
  siglaDaUfColada,
  ufBrasileiraValida,
} from "@/lib/uf-brasileira";
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

// Caracteres invisíveis que vêm junto de uma sigla copiada de site, PDF ou chat:
// espaço de largura zero (U+200B), marcas de direção (U+200E/U+200F) e BOM
// (U+FEFF). A pessoa não os vê e recebia "Estado inválido" sem entender o motivo.
// Montados por código (e não escritos no arquivo) para o teste ser legível.
describe("normalizarUf com caracteres invisíveis colados", () => {
  const ZWSP = String.fromCodePoint(0x200b);
  const LRM = String.fromCodePoint(0x200e);
  const RLM = String.fromCodePoint(0x200f);
  const BOM = String.fromCodePoint(0xfeff);
  const INVISIVEIS = [
    ["espaço de largura zero", ZWSP],
    ["marca da esquerda para a direita", LRM],
    ["marca da direita para a esquerda", RLM],
    ["BOM", BOM],
  ] as const;

  it.each(INVISIVEIS)(
    "sigla com %s colado depois, antes e no meio",
    (_nome, c) => {
      expect(normalizarUf(`mg${c}`)).toBe("MG");
      expect(normalizarUf(`${c}mg`)).toBe("MG");
      expect(normalizarUf(`m${c}g`)).toBe("MG");
      expect(normalizarUf(` ${c}sp${c} `)).toBe("SP");
      expect(ufBrasileiraValida(normalizarUf(`rs${c}`))).toBe(true);
    },
  );

  it.each(INVISIVEIS)(
    "nome completo com %s colado é reconhecido",
    (_nome, c) => {
      expect(normalizarUf(`Minas Gerais${c}`)).toBe("MG");
      expect(normalizarUf(`${c}São Paulo`)).toBe("SP");
    },
  );

  it("só invisíveis equivale a vazio", () => {
    expect(normalizarUf(ZWSP + LRM + RLM + BOM)).toBe("");
  });

  it("um nome desconhecido com invisível continua inválido, sem virar outra UF", () => {
    const resultado = normalizarUf(`Mato Grosso do Xul${ZWSP}`);
    expect(ufBrasileiraValida(resultado)).toBe(false);
  });

  it("o campo de colar (siglaDaUfColada) aceita sigla com invisível", () => {
    const campo = (value: string, inicio: number, fim: number) =>
      ({
        value,
        selectionStart: inicio,
        selectionEnd: fim,
      }) as HTMLInputElement;
    expect(siglaDaUfColada(campo("", 0, 0), `mg${ZWSP}`)).toBe("MG");
    expect(siglaDaUfColada(campo("", 0, 0), `${BOM}SP`)).toBe("SP");
    expect(siglaDaUfColada(campo("", 0, 0), `xx${ZWSP}`)).toBeUndefined();
  });
});
