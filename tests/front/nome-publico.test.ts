import { describe, expect, it } from "vitest";

describe("nome público na loja", () => {
  // A mesma matriz existe na prova viva de banco.
  it.each([
    [null, "Cliente"],
    ["", "Cliente"],
    [" \t\u{a0}", "Cliente"],
    ["Madonna", "Madonna"],
    ["Ana de Souza", "Ana S."],
    ["Ana Pereira de Souza", "Ana S."],
    ["Maria Costa Lima", "Maria L."],
    ["Maria Alves dE DA Do DAS Dos E", "Maria A."],
    ["João   das   Neves", "João N."],
    ["Ana-Maria Souza-Lima", "Ana-Maria S."],
    ["Érica álvares", "Érica Á."],
    [`Érica a${String.fromCodePoint(0x0301)}lvares`, "Érica Á."],
    ["Ana de", "Ana"],
    ["Maria ßauer", "Maria S."],
  ])(
    "converte %j em %j, inclusive ao reler uma cópia antiga",
    async (original, esperado) => {
      const { nomePublicoDe } = await import("@/lib/nome-publico");
      expect(nomePublicoDe(original)).toBe(esperado);
      expect(nomePublicoDe(esperado)).toBe(esperado);
    },
  );
});
