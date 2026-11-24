// `normalizarCodigoBarras` é a MESMA string que vai para o banco (btrim +
// igualdade exata) e a regra única do cadastro e do balcão. Nenhum teste
// provava a função sozinha; protege:
//  · zeros à esquerda ficam (nunca vira número: "0012345" não é "12345");
//  · espaço no meio (etiqueta EAN-13 impressa "789 1000 31550 7") some;
//  · tab, quebra de linha e espaço sem quebra (NBSP) também somem;
//  · as pontas são aparadas e o que sobra é só o código;
//  · só espaço vira vazio (o balcão não consulta o servidor por isso).
import {
  REGEX_CODIGO_BARRAS,
  normalizarCodigoBarras,
} from "@/lib/codigo-de-barras";
import { describe, expect, it } from "vitest";

describe("normalizarCodigoBarras", () => {
  it("mantém os zeros à esquerda", () => {
    expect(normalizarCodigoBarras("0012345")).toBe("0012345");
    expect(normalizarCodigoBarras(" 0000000000017 ")).toBe("0000000000017");
  });

  it("tira os espaços do meio (etiqueta com separador visual)", () => {
    expect(normalizarCodigoBarras("789 1000 31550 7")).toBe("7891000315507");
    expect(normalizarCodigoBarras("789    1000")).toBe("7891000");
  });

  it("tira tab, quebra de linha e espaço sem quebra do meio e das pontas", () => {
    expect(normalizarCodigoBarras("\t789\n1000\u00a031550 7\r\n")).toBe(
      "7891000315507",
    );
  });

  it("só espaço vira vazio", () => {
    expect(normalizarCodigoBarras("   \t ")).toBe("");
    expect(normalizarCodigoBarras("")).toBe("");
  });

  it("não mexe em letras, hífen nem caixa", () => {
    expect(normalizarCodigoBarras(" ab-12 Cd ")).toBe("ab-12Cd");
  });
});

describe("REGEX_CODIGO_BARRAS (formato do campo do cadastro)", () => {
  it("aceita de 4 a 64 caracteres de letra, número e hífen", () => {
    expect(REGEX_CODIGO_BARRAS.test("1234")).toBe(true);
    expect(REGEX_CODIGO_BARRAS.test("1".repeat(64))).toBe(true);
    expect(REGEX_CODIGO_BARRAS.test("aB-9z")).toBe(true);
  });

  it("recusa 3 e 65 caracteres, espaço, vazio e símbolo", () => {
    expect(REGEX_CODIGO_BARRAS.test("123")).toBe(false);
    expect(REGEX_CODIGO_BARRAS.test("1".repeat(65))).toBe(false);
    expect(REGEX_CODIGO_BARRAS.test("12 34")).toBe(false);
    expect(REGEX_CODIGO_BARRAS.test("")).toBe(false);
    expect(REGEX_CODIGO_BARRAS.test("12_34")).toBe(false);
    expect(REGEX_CODIGO_BARRAS.test("12.34")).toBe(false);
    expect(REGEX_CODIGO_BARRAS.test("\n1234")).toBe(false);
  });
});
