// `src/utils/campos-mexidos-do-produto.ts`: o que os testes vizinhos deixavam
// passar (caça por mutação).
//
//  - `variacaoMudou`: código de barras e foto da variação em branco ("") são a
//    MESMA coisa que ausente ou nulo. Se a tela devolve "" onde o banco tinha
//    null, a variação não pode virar "mexida" (iria inteira no salvar e
//    desfaria o preço próprio que outra pessoa pôs nela);
//  - `camposQueMudaram`: NaN contra NaN é "igual" (a comparação é por
//    `Object.is`, não `===`), e uma lista DENTRO de uma lista compara por
//    conteúdo, não por referência.
import {
  type VariacaoComparavel,
  camposQueMudaram,
  variacaoMudou,
  variacoesQueMudaram,
} from "@/utils/campos-mexidos-do-produto";
import { describe, expect, it } from "vitest";

const variacao = (
  extra: Partial<VariacaoComparavel> = {},
): VariacaoComparavel => ({
  id: "v1",
  name: "Cor",
  value: "Rosa",
  stockIncrement: 3,
  active: true,
  ...extra,
});

describe("variacaoMudou — vazio, nulo e ausente são a mesma coisa", () => {
  it.each([
    ["codigoBarras", ""],
    ["codigoBarras", null],
    ["imageUrl", ""],
    ["imageUrl", null],
  ] as const)("%s %j contra ausente não é mudança", (campo, vazio) => {
    expect(variacaoMudou(variacao({ [campo]: vazio }), variacao())).toBe(false);
    expect(variacaoMudou(variacao(), variacao({ [campo]: vazio }))).toBe(false);
  });

  it("'' contra null também é o mesmo vazio, nos dois campos", () => {
    expect(
      variacaoMudou(
        variacao({ codigoBarras: "", imageUrl: "" }),
        variacao({ codigoBarras: null, imageUrl: null }),
      ),
    ).toBe(false);
  });

  it("vazio que ganha valor continua sendo mudança (o controle do teste acima)", () => {
    expect(
      variacaoMudou(
        variacao({ codigoBarras: "789" }),
        variacao({ codigoBarras: "" }),
      ),
    ).toBe(true);
    expect(
      variacaoMudou(
        variacao({ imageUrl: "a.jpg" }),
        variacao({ imageUrl: null }),
      ),
    ).toBe(true);
  });

  it("no salvar: variação com código e foto '' contra ausentes na abertura fica de fora", () => {
    expect(
      variacoesQueMudaram(
        [variacao({ codigoBarras: "", imageUrl: "" })],
        [variacao()],
      ),
    ).toEqual([]);
  });
});

describe("camposQueMudaram — NaN e listas dentro de listas", () => {
  it("NaN contra NaN não é mudança (campo que a lojista não tocou não viaja)", () => {
    expect(
      camposQueMudaram({ peso: Number.NaN }, { peso: Number.NaN }),
    ).toEqual({});
  });

  it("NaN contra um número é mudança", () => {
    expect(camposQueMudaram({ peso: Number.NaN }, { peso: 2 })).toHaveProperty(
      "peso",
    );
  });

  it("lista de listas igual por conteúdo não vai; mudou um item de dentro, vai", () => {
    const base = { pares: [["a", "b"], ["c"]] };
    expect(camposQueMudaram({ pares: [["a", "b"], ["c"]] }, base)).toEqual({});
    expect(camposQueMudaram({ pares: [["a", "x"], ["c"]] }, base)).toEqual({
      pares: [["a", "x"], ["c"]],
    });
    expect(camposQueMudaram({ pares: [["a", "b"]] }, base)).toEqual({
      pares: [["a", "b"]],
    });
  });
});
