// `estoqueDoProdutoFoiMexido` em `src/utils/estoque-das-variacoes.ts`: duas
// bordas que os testes vizinhos deixavam passar (caça por mutação).
//
//  - TROCAR qual variação está ligada, mantendo o mesmo estoque (a "Rosa" com 5
//    desliga e a "Azul" com 5 liga) é mexer no estoque do produto: a composição
//    das ligadas leva o id junto do número. Só comparar os números diria "não
//    mexeu" e o salvar deixaria de mandar o estoque novo;
//  - estoque ausente de um lado e zero do outro é o MESMO zero (a tela conta
//    ausente como zero em todo lugar): não pode acusar mexida.
import { estoqueDoProdutoFoiMexido } from "@/utils/estoque-das-variacoes";
import { describe, expect, it } from "vitest";

type Variacao = { id: string; active: boolean; stockIncrement: number };

const v = (id: string, active: boolean, stockIncrement: number): Variacao => ({
  id,
  active,
  stockIncrement,
});

describe("estoqueDoProdutoFoiMexido — a composição das ligadas leva o id", () => {
  it("desligar a Rosa (5) e ligar a Azul (5): mesmo número, outra variação, é mexer", () => {
    const inicial = {
      stock: "5",
      variants: [v("rosa", true, 5), v("azul", false, 5)],
    };
    const atual = {
      stock: "5",
      variants: [v("rosa", false, 5), v("azul", true, 5)],
    };
    expect(estoqueDoProdutoFoiMexido(atual, inicial)).toBe(true);
  });

  it("controle: as mesmas ligadas, na mesma quantidade, não é mexer", () => {
    const inicial = {
      stock: "8",
      variants: [v("rosa", true, 5), v("azul", true, 3)],
    };
    const atual = {
      stock: "8",
      variants: [v("azul", true, 3), v("rosa", true, 5)],
    };
    expect(estoqueDoProdutoFoiMexido(atual, inicial)).toBe(false);
  });
});

describe("estoqueDoProdutoFoiMexido — estoque ausente conta como zero", () => {
  it("variação ligada com 0 contra a mesma sem número (linha lida sem o campo): não mexeu", () => {
    const semNumero = {
      id: "rosa",
      active: true,
    } as unknown as Variacao;
    const inicial = { stock: "0", variants: [semNumero] };
    const atual = { stock: "0", variants: [v("rosa", true, 0)] };
    expect(estoqueDoProdutoFoiMexido(atual, inicial)).toBe(false);
    expect(estoqueDoProdutoFoiMexido(inicial, atual)).toBe(false);
  });

  it("controle: sem número contra 4 é mexer", () => {
    const semNumero = {
      id: "rosa",
      active: true,
    } as unknown as Variacao;
    expect(
      estoqueDoProdutoFoiMexido(
        { stock: "4", variants: [v("rosa", true, 4)] },
        { stock: "0", variants: [semNumero] },
      ),
    ).toBe(true);
  });
});
