// A regra do estoque do produto quando ele tem variações — o porquê está no
// topo de `src/utils/estoque-das-variacoes.ts`. O que este arquivo prova, em
// função pura: a soma das ligadas (o que a tela já fazia), o zero UMA vez ao
// desligar a última ligada, e as bordas em que o número do lojista NÃO pode
// ser tocado (produto antigo sem nenhuma ligada, tela que se repete, lista
// que esvazia).
import { describe, expect, it } from "vitest";

import {
  estoqueDoProdutoPelasVariacoes,
  formComVariacoes,
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
