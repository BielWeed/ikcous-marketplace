// A ordenação lembrada da vitrine (caça por mutação): o valor guardado só vale
// se for EXATAMENTE uma das três ordenações de hoje. Texto parecido, com
// espaço, em outra caixa ou embrulhado em lista/objeto cai em "default" (a
// vitrine nunca fica vazia nem ordena por um valor que não existe mais).
import { describe, expect, it } from "vitest";

import { ORDENACOES_DA_HOME, ordenacaoValida } from "@/lib/ordenacao-da-home";

describe("ordenacaoValida: só o valor exato vale", () => {
  it.each(["default", "price-asc", "price-desc"])("%s passa igual", (valor) => {
    expect(ordenacaoValida(valor)).toBe(valor);
  });

  it.each([
    ["valor antigo 'sold'", "sold"],
    ["vazio", ""],
    ["com espaço no começo", " price-asc"],
    ["com espaço no fim", "price-asc "],
    ["em outra caixa", "PRICE-ASC"],
    ["parecido", "price_asc"],
    ["só um pedaço", "price"],
  ])("texto que não é uma ordenação (%s) vira default", (_nome, valor) => {
    expect(ordenacaoValida(valor)).toBe("default");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["zero", 0],
    ["falso", false],
    ["objeto vazio", {}],
    ["lista com a ordenação dentro", ["price-asc"]],
    ["texto embrulhado em objeto String", new String("price-desc")],
    ["objeto que se converte em texto válido", { toString: () => "price-asc" }],
  ])("valor que não é texto (%s) vira default", (_nome, valor) => {
    expect(ordenacaoValida(valor)).toBe("default");
  });

  it("a lista de ordenações oferecidas tem exatamente as três de hoje, sem 'sold'", () => {
    expect([...ORDENACOES_DA_HOME]).toEqual([
      "default",
      "price-asc",
      "price-desc",
    ]);
    expect(ORDENACOES_DA_HOME).not.toContain("sold");
  });
});
