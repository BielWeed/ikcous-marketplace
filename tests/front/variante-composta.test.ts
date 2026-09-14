// As regras puras da variante composta — o porquê do desenho está no topo de
// `src/utils/variante-composta.ts`. O que este arquivo prova: juntar pares na
// linha gravada, reabrir a linha em pares sem corromper casos que não
// desmontam limpo, e a validação que barra par pela metade e atributo
// repetido.
import { describe, expect, it } from "vitest";

import {
  dividirEmAtributos,
  juntarAtributos,
  validarAtributos,
} from "@/utils/variante-composta";

describe("juntarAtributos", () => {
  it("um par só sai CRU, igual ao caso simples de hoje", () => {
    expect(juntarAtributos([{ name: "Cor", value: "Branca" }])).toEqual({
      name: "Cor",
      value: "Branca",
    });
  });

  it("dois pares viram a linha composta com separador nos dois campos", () => {
    expect(
      juntarAtributos([
        { name: "Cor", value: "Branca" },
        { name: "Tamanho", value: "PP" },
      ]),
    ).toEqual({ name: "Cor / Tamanho", value: "Branca / PP" });
  });

  it("três pares continuam fechando", () => {
    expect(
      juntarAtributos([
        { name: "Cor", value: "Preta" },
        { name: "Tamanho", value: "M" },
        { name: "Voltagem", value: "220V" },
      ]),
    ).toEqual({
      name: "Cor / Tamanho / Voltagem",
      value: "Preta / M / 220V",
    });
  });

  it("corta espaços das pontas antes de juntar", () => {
    expect(
      juntarAtributos([
        { name: "  Cor  ", value: " Branca " },
        { name: "Tamanho", value: "PP " },
      ]),
    ).toEqual({ name: "Cor / Tamanho", value: "Branca / PP" });
  });
});

describe("dividirEmAtributos — o caminho de volta", () => {
  it("reabre a linha composta nos pares originais", () => {
    expect(dividirEmAtributos("Cor / Tamanho", "Branca / PP")).toEqual([
      { name: "Cor", value: "Branca" },
      { name: "Tamanho", value: "PP" },
    ]);
  });

  it("linha simples reabre como um par", () => {
    expect(dividirEmAtributos("Cor", "Branca")).toEqual([
      { name: "Cor", value: "Branca" },
    ]);
  });

  it("contagens que não fecham abrem como UM par com o texto bruto", () => {
    // Linha legada ou valor com " / " digitado à mão: nada se perde.
    expect(dividirEmAtributos("Cor", "Cinza / Preto")).toEqual([
      { name: "Cor", value: "Cinza / Preto" },
    ]);
  });

  it("o par bruto que não desmonta round-tripa idêntico", () => {
    const linha = { name: "Cor / Tamanho", value: "Cinza / Preto / P" };
    const reaberto = dividirEmAtributos(linha.name, linha.value);
    // 3 partes no valor contra 2 no nome: cai no fallback de um par só.
    expect(reaberto).toEqual([linha]);
    expect(juntarAtributos(reaberto)).toEqual(linha);
  });

  it("ida e volta fecham para o caso composto comum", () => {
    const pares = [
      { name: "Cor", value: "Branca" },
      { name: "Tamanho", value: "P" },
    ];
    const linha = juntarAtributos(pares);
    expect(dividirEmAtributos(linha.name, linha.value)).toEqual(pares);
  });
});

describe("validarAtributos", () => {
  it("aceita o caso composto válido", () => {
    expect(
      validarAtributos([
        { name: "Cor", value: "Branca" },
        { name: "Tamanho", value: "PP" },
      ]),
    ).toBeNull();
  });

  it("barra par pela metade: só atributo, sem valor", () => {
    expect(
      validarAtributos([
        { name: "Cor", value: "Branca" },
        { name: "Tamanho", value: "" },
      ]),
    ).toBe("O valor do atributo (ex: Espacial Grey) é obrigatório.");
  });

  it("barra par pela metade: só valor, sem atributo", () => {
    expect(
      validarAtributos([{ name: "", value: "Branca" }]),
    ).toBe("O nome do atributo (ex: Cor, Tamanho) é obrigatório.");
  });

  it("tudo vazio diz o que preencher", () => {
    expect(validarAtributos([{ name: "", value: "" }])).toBe(
      "Preencha o atributo (ex: Cor) e o valor (ex: Espacial Grey).",
    );
  });

  it("par vazio extra é ignorado — sobra de clique não obriga apagamento", () => {
    expect(
      validarAtributos([
        { name: "Cor", value: "Branca" },
        { name: "", value: "" },
      ]),
    ).toBeNull();
  });

  it("barra atributo repetido na mesma variante, mesmo com caixa diferente", () => {
    const erro = validarAtributos([
      { name: "Cor", value: "Branca" },
      { name: "COR", value: "Preta" },
    ]);
    expect(erro).toContain("repetido");
    expect(erro).toContain("Cor e Tamanho");
  });
});
