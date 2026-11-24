// Caça por mutação: `mesmoIdDePedido` não tinha teste direto. Sem ele, três
// trocas sobreviviam: comparar com `===` (link com id em MAIÚSCULAS dizia
// "Pedido não encontrado"), tirar a guarda de ausente e trocar `&&` por `||`
// (dois ids ausentes passavam a ser "o mesmo pedido" — e a ficha de um pedido
// podia ser aberta/atualizada em cima de outro).
import { mesmoIdDePedido, numeroDoPedido } from "@/lib/numero-do-pedido";
import { describe, expect, it } from "vitest";

const ID = "c35ce4dd-1234-4abc-8def-1a2b3c3884be";

describe("mesmoIdDePedido", () => {
  it("o mesmo id é o mesmo pedido", () => {
    expect(mesmoIdDePedido(ID, ID)).toBe(true);
  });

  it("link colado em MAIÚSCULAS casa com o uuid do banco em minúsculas (e o inverso)", () => {
    expect(mesmoIdDePedido(ID.toUpperCase(), ID)).toBe(true);
    expect(mesmoIdDePedido(ID, ID.toUpperCase())).toBe(true);
  });

  it("ids diferentes não são o mesmo pedido, nem por 1 caractere", () => {
    expect(mesmoIdDePedido(ID, ID.replace(/e$/, "f"))).toBe(false);
    expect(mesmoIdDePedido(ID, "outro")).toBe(false);
  });

  it("ausente nunca é igual a nada — nem a outro ausente", () => {
    expect(mesmoIdDePedido(null, null)).toBe(false);
    expect(mesmoIdDePedido(undefined, undefined)).toBe(false);
    expect(mesmoIdDePedido("", "")).toBe(false);
    expect(mesmoIdDePedido(null, undefined)).toBe(false);
  });

  it("só um lado ausente também é falso (sem lançar erro)", () => {
    expect(mesmoIdDePedido(ID, null)).toBe(false);
    expect(mesmoIdDePedido(undefined, ID)).toBe(false);
    expect(mesmoIdDePedido(ID, "")).toBe(false);
  });
});

describe("numeroDoPedido — fronteiras do tamanho", () => {
  it("id com exatamente 6 caracteres volta inteiro, em maiúsculas", () => {
    expect(numeroDoPedido("abc123")).toBe("ABC123");
  });

  it("id com 7 caracteres perde só o primeiro", () => {
    expect(numeroDoPedido("zabc123")).toBe("ABC123");
  });
});
