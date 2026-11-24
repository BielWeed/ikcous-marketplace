// A "variação principal" de um produto de cadastro antigo (cor e tamanho em
// linhas separadas) é a PRIMEIRA pela ordem fixa da grade: pelo NOME do grupo
// ("Cor" antes de "Tamanho") e só no empate de nome pelo id. É ela que dá o
// `variantId` do pedido, a chave da linha e o PREÇO cobrado.
//
// Mutação medida (ordenar só pelo id, sem olhar o nome): os testes que já
// existiam continuavam verdes, porque neles o id de "Cor" já vinha antes do id
// de "Tamanho". Com ids em ordem contrária à dos nomes (o caso normal de
// banco, que gera uuid aleatório), a cliente passava a ser cobrada pelo preço
// do grupo errado -- e o servidor recusava o pedido com "os valores mudaram".
import { describe, expect, it } from "vitest";

import { ordenarPelaGrade, precoDaEscolha } from "@/lib/escolhas-do-item";
import type { ProductVariant } from "@/types";

function variacao(
  id: string,
  name: string,
  extra: Partial<ProductVariant> = {},
): ProductVariant {
  return {
    id,
    productId: "p-1",
    name,
    value: `valor-${id}`,
    stockIncrement: 5,
    active: true,
    ...extra,
  };
}

describe("ordenarPelaGrade: o nome do grupo manda, o id só desempata", () => {
  const tamanho = variacao("a-id-baixo", "Tamanho");
  const cor = variacao("z-id-alto", "Cor");

  it("'Cor' vem antes de 'Tamanho' mesmo quando o id do tamanho é o menor", () => {
    expect(ordenarPelaGrade([tamanho, cor]).map((v) => v.id)).toEqual([
      "z-id-alto",
      "a-id-baixo",
    ]);
  });

  it("o resultado não depende da ordem em que as escolhas chegam", () => {
    const direta = ordenarPelaGrade([cor, tamanho]).map((v) => v.id);
    const invertida = ordenarPelaGrade([tamanho, cor]).map((v) => v.id);
    expect(invertida).toEqual(direta);
  });

  it("no empate de nome, o menor id vem primeiro", () => {
    const b = variacao("b", "Cor");
    const a = variacao("a", "Cor");
    expect(ordenarPelaGrade([b, a]).map((v) => v.id)).toEqual(["a", "b"]);
    expect(ordenarPelaGrade([a, b]).map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("não mexe na lista que recebeu", () => {
    const entrada = [tamanho, cor];
    ordenarPelaGrade(entrada);
    expect(entrada.map((v) => v.id)).toEqual(["a-id-baixo", "z-id-alto"]);
  });
});

describe("precoDaEscolha: cobra o preço da variação principal pela ordem da grade", () => {
  it("cobra o preço do grupo 'Cor' mesmo com o id de 'Tamanho' menor", () => {
    const tamanho = variacao("a-id-baixo", "Tamanho", { priceOverride: 80 });
    const cor = variacao("z-id-alto", "Cor", { priceOverride: 60 });
    expect(precoDaEscolha({ price: 100 }, [tamanho, cor])).toBe(60);
    expect(precoDaEscolha({ price: 100 }, [cor, tamanho])).toBe(60);
  });

  it("a principal sem preço próprio cai no preço do produto, sem emprestar o da outra", () => {
    const tamanho = variacao("a-id-baixo", "Tamanho", { priceOverride: 80 });
    const cor = variacao("z-id-alto", "Cor");
    expect(precoDaEscolha({ price: 100 }, [tamanho, cor])).toBe(100);
  });

  it("sem nenhuma escolha cobra o preço do produto", () => {
    expect(precoDaEscolha({ price: 100 }, [])).toBe(100);
  });
});
