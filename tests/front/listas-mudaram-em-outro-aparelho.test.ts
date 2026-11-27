// Caça 27/11 — as peças puras da recusa "a lista mudou em outro aparelho"
// (migration 20261643000000): reconhecer a recusa, escolher a frase pela
// coluna e reaplicar a escolha da lojista por cima da lista nova.
import { describe, expect, it } from "vitest";

import {
  AVISO_DA_POLITICA_MUDOU,
  CODIGO_LISTA_MUDOU,
  avisoDaListaQueMudou,
  ehListaQueMudou,
  reaplicarEscolha,
} from "@/lib/listas-mudaram-em-outro-aparelho";

describe("ehListaQueMudou", () => {
  it("só o código LST01 é a recusa", () => {
    expect(CODIGO_LISTA_MUDOU).toBe("LST01");
    expect(ehListaQueMudou({ code: "LST01" })).toBe(true);
    expect(ehListaQueMudou({ code: "PRD01" })).toBe(false);
    expect(ehListaQueMudou({ message: "LST01" })).toBe(false);
    expect(ehListaQueMudou(null)).toBe(false);
    expect(ehListaQueMudou("LST01")).toBe(false);
  });
});

describe("avisoDaListaQueMudou", () => {
  it("cada coluna tem a sua frase; coluna desconhecida cai na geral", () => {
    expect(avisoDaListaQueMudou({ details: "home_sections" })).toMatch(
      /^As vitrines foram mudadas em outro aparelho/,
    );
    expect(
      avisoDaListaQueMudou({ details: "formas_pagamento_entrega" }),
    ).toMatch(/^As formas de pagamento na entrega foram mudadas/);
    for (const coluna of [
      "metodos_locais",
      "metodos_nacionais",
      "categorias_sem_troca",
    ]) {
      expect(avisoDaListaQueMudou({ details: coluna })).toBe(
        AVISO_DA_POLITICA_MUDOU,
      );
    }
    expect(avisoDaListaQueMudou({ details: "outra" })).toMatch(
      /^Esta configuração foi mudada em outro aparelho/,
    );
    expect(avisoDaListaQueMudou(undefined)).toMatch(/^Esta configuração/);
  });
});

describe("reaplicarEscolha (visto, escolhido, servidor)", () => {
  it("sem mudança dela, devolve a do servidor", () => {
    expect(reaplicarEscolha(["a"], ["a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("o que ela acrescentou entra no fim; o que ela tirou sai", () => {
    expect(reaplicarEscolha(["a", "b"], ["b", "c"], ["a", "b", "d"])).toEqual([
      "b",
      "d",
      "c",
    ]);
  });

  it("o que os dois acrescentaram não duplica", () => {
    expect(reaplicarEscolha(["a"], ["a", "c"], ["a", "c"])).toEqual(["a", "c"]);
  });

  it("o que o outro já tirou e ela também tirou continua fora", () => {
    expect(reaplicarEscolha(["a", "b"], ["a"], ["a"])).toEqual(["a"]);
  });

  it("lista vazia nos três lados", () => {
    expect(reaplicarEscolha([], [], [])).toEqual([]);
  });

  it("com ordem canônica, o resultado segue a ordem e nunca traz item fora dela", () => {
    expect(
      reaplicarEscolha(["y"], ["y", "x"], ["z", "y"], { ordem: ["x", "y"] }),
    ).toEqual(["x", "y"]);
  });

  it("com `mesmo` sem maiúscula, a categoria com outra grafia é a mesma", () => {
    const mesmo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    expect(
      reaplicarEscolha(
        ["Roupa"],
        ["Roupa", "calçados"],
        ["Roupa", "Calçados"],
        {
          mesmo,
        },
      ),
    ).toEqual(["Roupa", "Calçados"]);
    expect(
      reaplicarEscolha(["Roupa"], [], ["ROUPA", "Brinquedo"], { mesmo }),
    ).toEqual(["Brinquedo"]);
  });
});
