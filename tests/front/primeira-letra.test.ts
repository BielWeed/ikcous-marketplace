import { describe, expect, it } from "vitest";

import { primeiraLetra } from "@/lib/primeira-letra";

describe("primeiraLetra — a inicial do nome sem cortar emoji ao meio", () => {
  it("nome com emoji no começo devolve o emoji inteiro", () => {
    expect(primeiraLetra("🌸 Maria")).toBe("🌸");
  });

  it("nome comum devolve a inicial em maiúscula", () => {
    expect(primeiraLetra("ana")).toBe("A");
  });

  it("ignora espaços do começo", () => {
    expect(primeiraLetra("   bruno")).toBe("B");
  });

  it("duas iniciais cortam por caractere inteiro", () => {
    expect(primeiraLetra("✨🎁 Caneca", 2)).toBe("✨🎁");
    expect(primeiraLetra("maria", 2)).toBe("MA");
  });

  it("nome vazio, só espaços, nulo ou ausente devolve o texto reserva", () => {
    expect(primeiraLetra("", 1, "?")).toBe("?");
    expect(primeiraLetra("   ", 2, "CX")).toBe("CX");
    expect(primeiraLetra(null, 1, "L")).toBe("L");
    expect(primeiraLetra(undefined)).toBe("");
  });

  it("o resultado nunca carrega surrogate solitário", () => {
    const resultado = primeiraLetra("🎁🎁", 1);
    expect(() => encodeURIComponent(resultado)).not.toThrow();
    expect(resultado).toBe("🎁");
  });
});
