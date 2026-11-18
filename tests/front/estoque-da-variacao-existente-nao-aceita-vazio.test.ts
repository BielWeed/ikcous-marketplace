import { erroDoEstoqueDaVariacao } from "@/utils/estoque-da-variacao";
import { describe, expect, it } from "vitest";

describe("estoque da variação existente não aceita vazio", () => {
  it.each(["", "   "])(
    "estoque %j de variação existente pede um número explícito",
    (texto) => {
      expect(erroDoEstoqueDaVariacao(texto, true)).toBe(
        "Informe o estoque da variação: digite 0 ou mais.",
      );
    },
  );

  it("variação nova e linha nova da grade continuam aceitando vazio como zero", () => {
    expect(erroDoEstoqueDaVariacao("", false)).toBeNull();
    expect(erroDoEstoqueDaVariacao("")).toBeNull();
  });

  it.each(["0", "20", " 5 "])("%j continua válido ao editar", (texto) => {
    expect(erroDoEstoqueDaVariacao(texto, true)).toBeNull();
  });
});
