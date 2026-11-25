// Leitura dos atributos gravados na variação (`src/utils/atributos-da-variacao.ts`).
// A loja e o painel usam as mesmas três funções: quebrar "Cor / Tamanho" em
// pares, dizer em que posição a fileira aparece na tela do cliente, e "dobrar"
// o nome (minúscula, sem acento, sem as pontas) para comparar. Os testes
// existentes cobrem o `tipoDoNome`; aqui ficam as bordas que uma caça por
// mutação mostrou sem guarda.
import {
  MAX_ATRIBUTOS_DA_GRADE,
  SEPARADOR_DE_ATRIBUTOS,
  dividirEmAtributos,
  dobrar,
  posicaoDoAtributo,
} from "@/utils/atributos-da-variacao";
import { describe, expect, it } from "vitest";

describe("as duas constantes que a grade e o cadastro combinam", () => {
  it("o separador é espaço-barra-espaço e a grade aceita até 3 atributos", () => {
    expect(SEPARADOR_DE_ATRIBUTOS).toBe(" / ");
    expect(MAX_ATRIBUTOS_DA_GRADE).toBe(3);
  });
});

describe("dividirEmAtributos", () => {
  it("nome e valor com o mesmo número de partes viram pares na ordem", () => {
    expect(dividirEmAtributos("Cor / Tamanho", "Azul / P")).toEqual([
      { name: "Cor", value: "Azul" },
      { name: "Tamanho", value: "P" },
    ]);
    expect(
      dividirEmAtributos("Cor / Tamanho / Voltagem", "Azul / P / 110V"),
    ).toEqual([
      { name: "Cor", value: "Azul" },
      { name: "Tamanho", value: "P" },
      { name: "Voltagem", value: "110V" },
    ]);
  });

  it("um atributo só vira um par só", () => {
    expect(dividirEmAtributos("Cor", "Azul")).toEqual([
      { name: "Cor", value: "Azul" },
    ]);
  });

  it("mais nomes do que valores: não inventa valor vazio, fica o par cru", () => {
    expect(dividirEmAtributos("Cor / Tamanho", "Azul")).toEqual([
      { name: "Cor / Tamanho", value: "Azul" },
    ]);
  });

  it("mais valores do que nomes (valor com ' / ' dentro): fica o par cru", () => {
    expect(dividirEmAtributos("Cor", "Azul / Marinho")).toEqual([
      { name: "Cor", value: "Azul / Marinho" },
    ]);
    expect(dividirEmAtributos("Cor / Tamanho", "Azul / P / M")).toEqual([
      { name: "Cor / Tamanho", value: "Azul / P / M" },
    ]);
  });

  it("só o espaço-barra-espaço separa: barra colada no texto não divide", () => {
    expect(dividirEmAtributos("Cor/Tamanho", "Azul/P")).toEqual([
      { name: "Cor/Tamanho", value: "Azul/P" },
    ]);
  });

  it("nome e valor vazios dão um par vazio, sem estourar", () => {
    expect(dividirEmAtributos("", "")).toEqual([{ name: "", value: "" }]);
  });
});

describe("dobrar: minúscula, sem acento e sem as pontas", () => {
  it.each([
    ["Lilás ", "lilas"],
    ["  MARINHO", "marinho"],
    ["AÇÃO", "acao"],
    ["Memória", "memoria"],
    ["cor", "cor"],
    ["", ""],
    ["   ", ""],
  ])("%j vira %j", (entrada, esperado) => {
    expect(dobrar(entrada)).toBe(esperado);
  });
});

describe("posicaoDoAtributo: Tamanho antes, Cor depois, o resto por último", () => {
  it.each([
    "Tamanho",
    "tamanho",
    " TAMANHO ",
    "Voltagem",
    "Capacidade",
    "Memória",
    "Armazenamento",
  ])("%j fica na frente (0)", (nome) => {
    expect(posicaoDoAtributo(nome)).toBe(0);
  });

  it.each(["Cor", "COR", " cor ", "Cores", "cores", "Color", "color"])(
    "%j fica no meio (1)",
    (nome) => {
      expect(posicaoDoAtributo(nome)).toBe(1);
    },
  );

  it.each([
    "Material",
    "Estampa",
    "Sabor",
    "",
    "   ",
    "Colorido",
    "Decores",
    "Cor / Tamanho",
  ])("%j fica por último (2)", (nome) => {
    expect(posicaoDoAtributo(nome)).toBe(2);
  });
});
