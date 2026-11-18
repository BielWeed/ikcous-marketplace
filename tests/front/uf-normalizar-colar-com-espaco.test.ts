// Colar " SP " no campo de UF: o navegador, com `maxLength={2}`, cortava o texto
// colado ANTES de qualquer limpeza e guardava " S" -- a cliente recebia "Estado
// inválido" por ter copiado uma UF válida. `normalizarUf` tira os espaços e põe em
// maiúsculas ANTES de cortar em 2 letras.

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

  it("corta em 2 letras só depois de limpar (nunca antes)", () => {
    expect(normalizarUf("sp123")).toBe("SP");
    expect(normalizarUf("  s  p  x")).toBe("SP");
  });

  it("o resultado de uma UF colada com espaço é uma UF válida", () => {
    expect(ufBrasileiraValida(normalizarUf(" sp "))).toBe(true);
  });
});
