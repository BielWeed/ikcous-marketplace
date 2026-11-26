// `alinharPelaOrdemGravada` (variante composta): só a SOBRA vazia dos DOIS lados
// (nome e valor sem nada, ou só com espaço) é descartada antes de comparar com a
// ordem gravada do produto. Duas bordas que os testes vizinhos não seguravam:
//
//  - o par pela metade (nome sem valor) NÃO é sobra: continua contando, e a
//    combinação ainda é reordenada para a ordem que o produto já grava. Se
//    virasse sobra, a contagem não fecharia e a ordem do formulário seguiria
//    como está — o nome gravado "Cor / Tamanho" ficaria "Tamanho / Cor" e a
//    trava de um grupo só recusaria o salvar;
//  - valor só com espaço, em par sem nome, É sobra (como o vazio de verdade): se
//    contasse, o "+ Atributo" clicado e esquecido atrapalharia o alinhamento.
import { alinharPelaOrdemGravada } from "@/utils/variante-composta";
import { describe, expect, it } from "vitest";

describe("alinharPelaOrdemGravada — o que é sobra e o que não é", () => {
  it("par pela metade (nome sem valor) conta: os pares seguem a ordem gravada", () => {
    expect(
      alinharPelaOrdemGravada(
        [
          { name: "Tamanho", value: "PP" },
          { name: "Cor", value: "" },
        ],
        "Cor / Tamanho",
      ),
    ).toEqual([
      { name: "Cor", value: "" },
      { name: "Tamanho", value: "PP" },
    ]);
  });

  it("par só com valor (sem nome) também conta como par, não como sobra", () => {
    expect(
      alinharPelaOrdemGravada(
        [
          { name: "Tamanho", value: "PP" },
          { name: "", value: "Branca" },
        ],
        "Cor / Tamanho",
      ),
    ).toEqual([
      { name: "Tamanho", value: "PP" },
      { name: "", value: "Branca" },
    ]);
  });

  it("par sem nome e com valor só de espaço é sobra: não atrapalha o alinhamento", () => {
    expect(
      alinharPelaOrdemGravada(
        [
          { name: "Tamanho", value: "PP" },
          { name: "Cor", value: "Branca" },
          { name: "", value: "   " },
        ],
        "Cor / Tamanho",
      ),
    ).toEqual([
      { name: "Cor", value: "Branca" },
      { name: "Tamanho", value: "PP" },
    ]);
  });

  it("par com nome só de espaço e valor vazio é sobra", () => {
    expect(
      alinharPelaOrdemGravada(
        [
          { name: "Tamanho", value: "PP" },
          { name: "Cor", value: "Branca" },
          { name: "  ", value: "" },
        ],
        "Cor / Tamanho",
      ),
    ).toEqual([
      { name: "Cor", value: "Branca" },
      { name: "Tamanho", value: "PP" },
    ]);
  });
});
