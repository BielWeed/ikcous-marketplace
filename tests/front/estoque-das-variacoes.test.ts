// A regra do estoque do produto quando ele tem variações — o porquê está no
// topo de `src/utils/estoque-das-variacoes.ts`. O que este arquivo prova, em
// função pura: a soma das ligadas (o que a tela já fazia), o zero UMA vez ao
// desligar a última ligada, e as bordas em que o número do lojista NÃO pode
// ser tocado (produto antigo sem nenhuma ligada, tela que se repete, lista
// que esvazia).
import { describe, expect, it } from "vitest";

import {
  estoqueDoProdutoFoiMexido,
  estoqueDoProdutoPelasVariacoes,
  formComVariacoes,
  variacoesSoComEstoqueMexido,
} from "@/utils/estoque-das-variacoes";

const ligada = (estoque: number) => ({ active: true, stockIncrement: estoque });
const desligada = (estoque: number) => ({
  active: false,
  stockIncrement: estoque,
});

describe("estoqueDoProdutoPelasVariacoes", () => {
  it("com variações ligadas, o estoque do produto é a soma das ligadas", () => {
    const depois = [ligada(3), ligada(10), desligada(99)];
    expect(estoqueDoProdutoPelasVariacoes(depois, depois, "0")).toBe("13");
  });

  it("não pede mudança quando a soma já é o estoque mostrado", () => {
    const depois = [ligada(3), ligada(10)];
    expect(estoqueDoProdutoPelasVariacoes(depois, depois, "13")).toBeNull();
  });

  it("religar uma variação volta a somar as ligadas", () => {
    expect(
      estoqueDoProdutoPelasVariacoes(
        [desligada(4), desligada(6)],
        [ligada(4), desligada(6)],
        "0",
      ),
    ).toBe("4");
  });

  it("desligar a ÚLTIMA ligada zera o estoque do produto", () => {
    expect(
      estoqueDoProdutoPelasVariacoes(
        [ligada(5), desligada(2)],
        [desligada(5), desligada(2)],
        "5",
      ),
    ).toBe("0");
  });

  it("desligar uma variação quando ainda sobra outra ligada só refaz a soma", () => {
    expect(
      estoqueDoProdutoPelasVariacoes(
        [ligada(5), ligada(2)],
        [desligada(5), ligada(2)],
        "7",
      ),
    ).toBe("2");
  });

  it("é UMA vez só: com tudo já desligado, o que o lojista digitar depois não é zerado", () => {
    const tudoDesligado = [desligada(5), desligada(2)];
    expect(
      estoqueDoProdutoPelasVariacoes(tudoDesligado, tudoDesligado, "8"),
    ).toBeNull();
  });

  it("produto antigo sem nenhuma variação ligada NÃO é tocado ao abrir", () => {
    // Na abertura a lista anterior é vazia: não houve "desligar a última".
    expect(
      estoqueDoProdutoPelasVariacoes([], [desligada(5), desligada(2)], "12"),
    ).toBeNull();
    expect(estoqueDoProdutoPelasVariacoes([], [], "12")).toBeNull();
  });

  it("produto sem variações que ganha a primeira ligada passa a somar", () => {
    expect(estoqueDoProdutoPelasVariacoes([], [ligada(0)], "12")).toBe("0");
  });

  it("apagar todas as variações (lista vazia) não mexe no estoque do produto", () => {
    expect(estoqueDoProdutoPelasVariacoes([ligada(5)], [], "5")).toBeNull();
  });

  it("já em zero, desligar a última não pede mudança", () => {
    expect(
      estoqueDoProdutoPelasVariacoes([ligada(0)], [desligada(0)], "0"),
    ).toBeNull();
  });

  it("estoque de variação ausente ou inválido conta como zero, como a tela já contava", () => {
    const depois = [
      ligada(4),
      { active: true, stockIncrement: Number.NaN },
      { active: true, stockIncrement: undefined as unknown as number },
    ];
    expect(estoqueDoProdutoPelasVariacoes(depois, depois, "0")).toBe("4");
  });
});

describe("formComVariacoes", () => {
  it("troca a lista e acerta o estoque pela transição, sem mexer no resto", () => {
    const anterior = {
      name: "Camiseta",
      stock: "5",
      variants: [ligada(5)],
    };
    const depois = formComVariacoes(anterior, [desligada(5)]);
    expect(depois).toEqual({
      name: "Camiseta",
      stock: "0",
      variants: [desligada(5)],
    });
    // Imutável: o formulário anterior não é alterado.
    expect(anterior.stock).toBe("5");
  });

  it("sem transição devolve o estoque como estava (número do lojista fica)", () => {
    const anterior = { stock: "12", variants: [desligada(5)] };
    const depois = formComVariacoes(anterior, [desligada(5), desligada(2)]);
    expect(depois.stock).toBe("12");
    expect(depois.variants).toHaveLength(2);
  });
});

// Salvar só devolve o estoque quando a lojista mexeu nele: o número que a tela
// leu ao abrir fica velho quando uma venda o desconta no banco.
const v = (id: string, estoque: number, active = true) => ({
  id,
  active,
  stockIncrement: estoque,
});

describe("estoqueDoProdutoFoiMexido", () => {
  it("sem variação: vale o texto do campo (igual = não mexeu; diferente = mexeu; zero é mexer)", () => {
    const inicial = { stock: "5", variants: [] };
    expect(
      estoqueDoProdutoFoiMexido({ stock: "5", variants: [] }, inicial),
    ).toBe(false);
    expect(
      estoqueDoProdutoFoiMexido({ stock: "20", variants: [] }, inicial),
    ).toBe(true);
    expect(
      estoqueDoProdutoFoiMexido({ stock: "0", variants: [] }, inicial),
    ).toBe(true);
  });

  it("com variação ligada: o texto do campo (a soma que a tela fez) não acusa nada; só as variações acusam", () => {
    const inicial = { stock: "7", variants: [v("a", 3), v("b", 2)] };
    // A tela mostrou a soma (5) e o banco guardava 7: ninguém tocou em nada.
    expect(
      estoqueDoProdutoFoiMexido(
        { stock: "5", variants: [v("a", 3), v("b", 2)] },
        inicial,
      ),
    ).toBe(false);
    expect(
      estoqueDoProdutoFoiMexido(
        { stock: "12", variants: [v("a", 10), v("b", 2)] },
        inicial,
      ),
    ).toBe(true);
  });

  it("desligar, religar ou apagar uma variação ligada é mexer; acrescentar uma DESLIGADA não", () => {
    const inicial = { stock: "5", variants: [v("a", 3), v("b", 2)] };
    expect(
      estoqueDoProdutoFoiMexido(
        { stock: "2", variants: [v("a", 3, false), v("b", 2)] },
        inicial,
      ),
    ).toBe(true);
    expect(
      estoqueDoProdutoFoiMexido({ stock: "2", variants: [v("b", 2)] }, inicial),
    ).toBe(true);
    expect(
      estoqueDoProdutoFoiMexido(
        { stock: "5", variants: [v("a", 3), v("b", 2), v("n", 9, false)] },
        inicial,
      ),
    ).toBe(false);
  });

  it("apagar TODAS as variações: o campo volta a ser da lojista e o número dela vai", () => {
    const inicial = { stock: "5", variants: [v("a", 3), v("b", 2)] };
    expect(
      estoqueDoProdutoFoiMexido({ stock: "5", variants: [] }, inicial),
    ).toBe(true);
  });

  it("produto que já abriu sem nenhuma variação ligada: o campo é da lojista", () => {
    const inicial = { stock: "4", variants: [v("a", 3, false)] };
    expect(
      estoqueDoProdutoFoiMexido(
        { stock: "4", variants: [v("a", 3, false)] },
        inicial,
      ),
    ).toBe(false);
    expect(
      estoqueDoProdutoFoiMexido(
        { stock: "9", variants: [v("a", 3, false)] },
        inicial,
      ),
    ).toBe(true);
  });
});

describe("variacoesSoComEstoqueMexido", () => {
  it("a existente sem mexida perde a chave; a mexida, a nova (temp-) e a que não estava na abertura levam o número", () => {
    const iniciais = [v("a", 3), v("b", 2)];
    const atuais = [v("a", 3), v("b", 8), v("temp-1", 4), v("c", 6)];

    const saida = variacoesSoComEstoqueMexido(atuais, iniciais);

    expect(saida[0]).not.toHaveProperty("stockIncrement");
    expect(saida[0]).toMatchObject({ id: "a", active: true });
    expect(saida[1]).toMatchObject({ id: "b", stockIncrement: 8 });
    expect(saida[2]).toMatchObject({ id: "temp-1", stockIncrement: 4 });
    expect(saida[3]).toMatchObject({ id: "c", stockIncrement: 6 });
  });

  it("não altera a lista de entrada e aceita lista vazia", () => {
    const atuais = [v("a", 3)];
    variacoesSoComEstoqueMexido(atuais, [v("a", 3)]);
    expect(atuais[0]).toHaveProperty("stockIncrement", 3);
    expect(variacoesSoComEstoqueMexido([], [])).toEqual([]);
  });
});
