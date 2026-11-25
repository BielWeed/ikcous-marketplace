// Quatro bordas da variante composta ("Cor / Tamanho") que `variante-composta
// .test.ts` não prendia — cada uma foi achada tirando a regra do código e vendo
// o arquivo de teste inteiro continuar verde:
//
//  1. Produto já gravado com 2 atributos e o formulário com 3: os pares voltam
//     como vieram (quem recusa é a trava de um grupo). Sem a conferência de
//     quantidade, o terceiro atributo SUMIA da identidade da linha em silêncio
//     (a variante seria salva como "Cor / Tamanho" sem a estampa digitada).
//  2. Cada par do formulário alinha com UM nome gravado: com nomes gravados
//     repetidos, o mesmo par não pode ser usado duas vezes e apagar o outro.
//  3. Atributo só com nome, ou só com valor (linha pela metade), nunca entra na
//     identidade gravada — "Cor / Tamanho / " ficaria no banco.
//  4. "Cor " (com espaço) e "cor" são o MESMO atributo na checagem de repetido.
import {
  alinharPelaOrdemGravada,
  juntarAtributos,
  validarAtributos,
} from "@/utils/variante-composta";
import { describe, expect, it } from "vitest";

describe("alinharPelaOrdemGravada — quantidade de atributos", () => {
  it("formulário com MAIS atributos que o nome gravado: volta como veio, nada é descartado", () => {
    const formulario = [
      { name: "Tamanho", value: "P" },
      { name: "Cor", value: "Azul" },
      { name: "Estampa", value: "Lisa" },
    ];

    const resultado = alinharPelaOrdemGravada(formulario, "Cor / Tamanho");

    expect(resultado).toEqual(formulario);
    expect(resultado).toHaveLength(3);
  });

  it("formulário com MENOS atributos que o nome gravado: volta como veio", () => {
    const formulario = [{ name: "Tamanho", value: "P" }];

    expect(alinharPelaOrdemGravada(formulario, "Cor / Tamanho")).toEqual(
      formulario,
    );
  });

  it("mesma quantidade e mesmo conjunto: segue a ordem e a grafia gravadas", () => {
    const resultado = alinharPelaOrdemGravada(
      [
        { name: "tamanho", value: "P" },
        { name: "COR", value: "Azul" },
      ],
      "Cor / Tamanho",
    );

    expect(resultado).toEqual([
      { name: "Cor", value: "Azul" },
      { name: "Tamanho", value: "P" },
    ]);
  });
});

describe("alinharPelaOrdemGravada — cada par é usado uma vez só", () => {
  it("nomes gravados que só diferem na caixa casam com um par cada, sem repetir o primeiro", () => {
    const resultado = alinharPelaOrdemGravada(
      [
        { name: "Cor", value: "A" },
        { name: "cor", value: "B" },
      ],
      "Cor / cor",
    );

    expect(resultado.map((par) => par.value)).toEqual(["A", "B"]);
    expect(resultado.map((par) => par.name)).toEqual(["Cor", "cor"]);
  });
});

describe("juntarAtributos — linha pela metade fica de fora", () => {
  it("par só com nome e par só com valor não entram na identidade", () => {
    expect(
      juntarAtributos([
        { name: "Cor", value: "Azul" },
        { name: "Tamanho", value: "" },
        { name: "", value: "P" },
      ]),
    ).toEqual({ name: "Cor", value: "Azul" });
  });

  it("par vazio dos dois lados também fica de fora, e os espaços das pontas saem", () => {
    expect(
      juntarAtributos([
        { name: " Cor ", value: " Azul " },
        { name: " ", value: " " },
        { name: "Tamanho", value: "P" },
      ]),
    ).toEqual({ name: "Cor / Tamanho", value: "Azul / P" });
  });
});

describe("validarAtributos — atributo repetido", () => {
  it("'Cor ' e 'cor' são o mesmo atributo (espaço e caixa não distinguem)", () => {
    expect(
      validarAtributos([
        { name: "Cor ", value: "A" },
        { name: "cor", value: "B" },
      ]),
    ).toBe(
      'O atributo "cor" está repetido — nesta variante use atributos diferentes (ex: Cor e Tamanho).',
    );
  });

  it("atributos diferentes passam", () => {
    expect(
      validarAtributos([
        { name: "Cor", value: "A" },
        { name: "Tamanho", value: "P" },
      ]),
    ).toBeNull();
  });
});
